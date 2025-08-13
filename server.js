const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const WebSocket = require('ws');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

// Serve socket.io client files explicitly to avoid 404
app.use('/socket.io', express.static(__dirname + '/node_modules/socket.io/client-dist'));

app.use(express.static('public'));

// SECURITY FIX: Load API key from environment variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
    console.error('ERROR: GEMINI_API_KEY not found in environment variables');
    process.exit(1);
}

// CORRECTED: Proper WebSocket URL for Gemini Live API
const GEMINI_API_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

class GeminiLiveSession {
    constructor(socket) {
        this.socket = socket;
        this.ws = null;
        this.sessionId = null;
        this.isConnected = false;
        this.setupComplete = false;
        
        // FIXED: Simplified audio management to prevent duplicates
        this.currentAudioBuffer = [];
        this.audioBufferTimeout = null;
        this.AUDIO_BUFFER_DELAY = 150; // Increased buffer delay
        this.isProcessingAudio = false; // Prevent concurrent audio processing
        this.audioSequenceId = 0; // Track audio sequences
    }

    async start() {
        const wsUrl = `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`;
        console.log('Connecting to Gemini Live API...');

        this.ws = new WebSocket(wsUrl, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        this.ws.on('open', () => {
console.log('Connected to Gemini Live API');
            this.isConnected = true;

            // FIXED: Correct setup message format for Gemini Live API
            const setupMessage = {
                setup: {
                    model: "models/gemini-2.0-flash-exp",
                    generation_config: {
                        response_modalities: ["AUDIO"],
                        speech_config: {
                            voice_config: {
                                prebuilt_voice_config: {
                                    voice_name: "Aoede"
                                }
                            }
                        }
                    },
                    system_instruction: {
                        parts: [{
                            text: "You are a helpful assistant for Revolt Motors. Only provide information about Revolt Motors, their electric motorcycles, features, pricing, availability, and related topics. Keep responses concise and conversational for voice chat. Do not discuss other brands or unrelated topics."
                        }]
                    }
                }
            };

console.log('Sending setup message...');
            this.ws.send(JSON.stringify(setupMessage));
        });

        this.ws.on('message', (data) => {
            try {
                const response = JSON.parse(data);
                console.log('📥 Received response type:', Object.keys(response).join(', '));

                // Handle setup completion
                if (response.setupComplete) {
console.log('Setup completed successfully');
                    this.setupComplete = true;
                    this.socket.emit('setup_complete');
                    return;
                }

                // Handle server content
                if (response.serverContent) {
                    // FIXED: Process audio with deduplication
                    if (response.serverContent.modelTurn) {
                        this.processModelTurn(response.serverContent.modelTurn);
                    }

                    // Handle turn completion - send final audio buffer ONLY
                    if (response.serverContent.turnComplete) {
console.log('Turn completed');
                        this.finalizeTurn();
                    }
                }

                // Handle errors in response
                if (response.error) {
                    console.error('❌ API Error:', response.error);
                    this.socket.emit('api_error', response.error);
                }

            } catch (error) {
                console.error('Error parsing Gemini response:', error);
                console.log('Raw response:', data.toString().substring(0, 200) + '...');
            }
        });

        this.ws.on('error', (error) => {
            console.error('WebSocket error:', error);
            this.isConnected = false;
            
            // Enhanced error handling
            let errorMessage = 'Connection error';
            let details = error.message || 'Unknown error';
            
            if (error.message) {
                if (error.message.includes('quota') || error.message.includes('QUOTA')) {
                    errorMessage = 'API quota exceeded';
                    details = 'Your Gemini API quota has been exceeded.';
                } else if (error.message.includes('401') || error.message.includes('unauthorized')) {
                    errorMessage = 'Invalid API key';
                    details = 'The provided API key is invalid or expired.';
                } else if (error.message.includes('403') || error.message.includes('forbidden')) {
                    errorMessage = 'Access denied';
                    details = 'The API key does not have permission to access this service.';
                } else if (error.message.includes('429')) {
                    errorMessage = 'Rate limit exceeded';
                    details = 'Too many requests. Please wait before trying again.';
                }
            }
            
            this.socket.emit('error', { 
                message: errorMessage, 
                details: details,
                code: error.code
            });
        });

        this.ws.on('close', (code, reason) => {
            console.log(`Gemini API connection closed. Code: ${code}, Reason: ${reason?.toString()}`);
            this.isConnected = false;
            this.setupComplete = false;
            
            // Clear audio buffers on close
            this.clearAudioBuffers();
            
            // Enhanced close code handling
            let errorMessage = 'Connection closed unexpectedly';
            
            switch (code) {
                case 1000:
                    errorMessage = 'Connection closed normally';
                    break;
                case 1001:
                    errorMessage = 'Server going down';
                    break;
                case 1002:
                    errorMessage = 'Protocol error';
                    break;
                case 1003:
                    errorMessage = 'Unsupported data type';
                    break;
                case 1006:
                    errorMessage = 'Connection lost - network issue';
                    break;
                case 1007:
                    errorMessage = 'Invalid message format sent to server';
                    break;
                case 1008:
                    errorMessage = 'Policy violation - check API key';
                    break;
                case 1011:
                    errorMessage = 'Server error occurred';
                    break;
                default:
                    if (reason && reason.toString()) {
                        errorMessage = reason.toString();
                    }
            }
            
            this.socket.emit('connection_closed', { 
                code: code, 
                reason: errorMessage 
            });
        });
    }

    // NEW: Process model turn with proper audio handling
    processModelTurn(modelTurn) {
        if (this.isProcessingAudio) {
            console.log('Skipping audio processing - already in progress');
            return;
        }

        const parts = modelTurn.parts || [];
        let hasAudio = false;
        let hasText = false;

        for (const part of parts) {
            if (part.inlineData && part.inlineData.mimeType?.startsWith('audio/')) {
                console.log('Received audio chunk, buffering...');
                this.handleAudioChunk(part.inlineData.data, part.inlineData.mimeType);
                hasAudio = true;
            }
            
            if (part.text) {
                console.log('Text response:', part.text.substring(0, 100) + '...');
                this.socket.emit('text_response', { text: part.text });
                hasText = true;
            }
        }

        // If we have audio, don't send it immediately - wait for turn completion
        if (hasAudio) {
            console.log('Audio buffered, waiting for turn completion...');
        }
    }

    // FIXED: Handle audio chunks without immediate sending
    handleAudioChunk(audioData, mimeType) {
        // Add to buffer without timeout-based flushing
        this.currentAudioBuffer.push({
            data: audioData,
            mimeType: mimeType,
            timestamp: Date.now()
        });

        console.log(`Audio chunk buffered (${this.currentAudioBuffer.length} total chunks)`);
    }

    // NEW: Finalize turn and send complete audio
    finalizeTurn() {
        if (this.currentAudioBuffer.length === 0) {
            console.log('Turn completed - no audio to send');
            this.socket.emit('turn_complete');
            return;
        }

        if (this.isProcessingAudio) {
            console.log('Already processing audio, skipping...');
            return;
        }

        this.isProcessingAudio = true;
        const sequenceId = ++this.audioSequenceId;

        try {
            console.log(`Finalizing turn - processing ${this.currentAudioBuffer.length} audio chunks`);
            
            // Send single consolidated audio response
            const consolidatedAudio = this.consolidateAudioChunks(this.currentAudioBuffer);
            
            if (consolidatedAudio) {
                console.log(`Sending consolidated audio (sequence: ${sequenceId})`);
                this.socket.emit('audio_response', {
                    audio: consolidatedAudio.data,
                    mimeType: consolidatedAudio.mimeType,
                    sequenceId: sequenceId
                });
            }

            // Clear buffer after sending
            this.currentAudioBuffer = [];
            this.socket.emit('turn_complete');

        } catch (error) {
            console.error('Error finalizing turn:', error);
        } finally {
            this.isProcessingAudio = false;
        }
    }

    // IMPROVED: Consolidate audio chunks more efficiently
    consolidateAudioChunks(chunks) {
        if (chunks.length === 0) return null;

        try {
            const mimeType = chunks[0].mimeType;
            console.log(`Consolidating ${chunks.length} chunks of type: ${mimeType}`);
            
            if (chunks.length === 1) {
                // Single chunk - return directly
                return {
                    data: chunks[0].data,
                    mimeType: mimeType
                };
            }

            // Multiple chunks - concatenate binary data
            const binaryChunks = chunks.map(chunk => {
                try {
                    return Buffer.from(chunk.data, 'base64');
                } catch (error) {
                    console.error('Error decoding audio chunk:', error);
                    return Buffer.alloc(0);
                }
            });

            // Filter out empty buffers
            const validChunks = binaryChunks.filter(chunk => chunk.length > 0);
            
            if (validChunks.length === 0) {
                console.warn('No valid audio chunks to consolidate');
                return null;
            }

            // Concatenate all binary data
            const totalLength = validChunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const consolidatedBuffer = Buffer.concat(validChunks, totalLength);
            const consolidatedBase64 = consolidatedBuffer.toString('base64');

            console.log(`Consolidated ${validChunks.length} chunks into ${consolidatedBase64.length} chars`);

            return {
                data: consolidatedBase64,
                mimeType: mimeType
            };

        } catch (error) {
            console.error('Error consolidating audio chunks:', error);
            
            // Fallback: return first valid chunk
            if (chunks.length > 0) {
                return {
                    data: chunks[0].data,
                    mimeType: chunks[0].mimeType
                };
            }
            return null;
        }
    }

    // IMPROVED: Clear all audio buffers
    clearAudioBuffers() {
        this.currentAudioBuffer = [];
        this.isProcessingAudio = false;
        this.audioSequenceId = 0;
        
        if (this.audioBufferTimeout) {
            clearTimeout(this.audioBufferTimeout);
            this.audioBufferTimeout = null;
        }
    }

    sendAudio(audioData) {
        if (!this.isConnected || !this.setupComplete || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
console.log('Cannot send audio: Connection not ready');
            return;
        }

        try {
            // FIXED: Correct message format for Gemini Live API
            let base64Audio;
            if (Buffer.isBuffer(audioData)) {
                base64Audio = audioData.toString('base64');
            } else if (Array.isArray(audioData)) {
                // Convert Int16Array to Buffer then to base64
                const buffer = Buffer.from(new Int16Array(audioData).buffer);
                base64Audio = buffer.toString('base64');
            } else {
                console.error('Invalid audio data format');
                return;
            }

            // CORRECTED: Proper message structure for Gemini Live API
            const message = {
                realtimeInput: {
                    mediaChunks: [{
                        mimeType: "audio/pcm;rate=16000",
                        data: base64Audio
                    }]
                }
            };

            this.ws.send(JSON.stringify(message));

        } catch (error) {
            console.error('Error sending audio:', error);
            this.socket.emit('error', { 
                message: 'Failed to send audio', 
                details: error.message 
            });
        }
    }

    sendText(text) {
        if (!this.isConnected || !this.setupComplete || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
console.log('Cannot send text: Connection not ready');
            return;
        }

        try {
            const message = {
                clientContent: {
                    turns: [{
                        role: "user",
                        parts: [{ text: text }]
                    }],
                    turnComplete: true
                }
            };

            console.log('Sending text message:', text.substring(0, 50) + '...');
            this.ws.send(JSON.stringify(message));
        } catch (error) {
            console.error('Error sending text:', error);
        }
    }

    interrupt() {
        if (this.isConnected && this.setupComplete && this.ws && this.ws.readyState === WebSocket.OPEN) {
            // Clear any buffered audio when interrupting
            this.clearAudioBuffers();
            
            const interruptMessage = {
                clientContent: {
                    turns: [],
                    turnComplete: true
                }
            };
            console.log('Sending interrupt signal');
            this.ws.send(JSON.stringify(interruptMessage));
            
            // Notify client that audio should stop
            this.socket.emit('audio_interrupted');
        }
    }

    close() {
        this.isConnected = false;
        this.setupComplete = false;
        this.clearAudioBuffers();
        
        if (this.ws) {
            this.ws.close(1000, 'Client disconnecting');
        }
    }
}

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    let session = null;

    socket.on('start_session', async () => {
        try {
            if (session) {
                session.close();
            }
            console.log('Starting new Gemini session...');
            session = new GeminiLiveSession(socket);
            await session.start();
        } catch (error) {
            console.error('Failed to start session:', error);
            socket.emit('error', { 
                message: 'Failed to start session', 
                details: error.message 
            });
        }
    });

    socket.on('audio_data', (data) => {
        if (session) {
            session.sendAudio(data);
        } else {
            socket.emit('error', { 
                message: 'No active session', 
                details: 'Please start a session first' 
            });
        }
    });

    socket.on('text_message', (data) => {
        console.log('Received text message:', data.text);
        if (session) {
            session.sendText(data.text);
        } else {
            socket.emit('error', { 
                message: 'No active session', 
                details: 'Please start a session first' 
            });
        }
    });

    socket.on('interrupt', () => {
        console.log('Interrupt requested');
        if (session) {
            session.interrupt();
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        if (session) {
            session.close();
            session = null;
        }
    });
});

const DEFAULT_PORT = 3002;

function getAvailablePort(startPort) {
    const net = require('net');
    return new Promise((resolve) => {
        function checkPort(port) {
            const server = net.createServer();
            server.once('error', () => {
                checkPort(port + 1);
            });
            server.once('listening', () => {
                server.close(() => {
                    resolve(port);
                });
            });
            server.listen(port);
        }
        checkPort(startPort);
    });
}

(async () => {
    let port = process.env.PORT ? parseInt(process.env.PORT) : DEFAULT_PORT;
    const net = require('net');

    // Check if port is available, if not find next available port
    const isPortAvailable = (port) => {
        return new Promise((resolve) => {
            const tester = net.createServer()
                .once('error', () => resolve(false))
                .once('listening', () => tester.once('close', () => resolve(true)).close())
                .listen(port);
        });
    };

    if (!(await isPortAvailable(port))) {
        port = await getAvailablePort(port + 1);
    }

    server.listen(port, () => {
        console.log(`🚀 Server running on port ${port}`);
        console.log(`🌐 Open http://localhost:${port} in your browser`);
        console.log('🔑 Make sure GEMINI_API_KEY is set in your .env file');
    });
})();