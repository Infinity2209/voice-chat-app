class VoiceChatApp {
    constructor() {
        this.socket = null;
        this.mediaRecorder = null;
        this.audioContext = null;
        this.playbackAudioContext = null; // Separate context for audio playback
        this.audioStream = null;
        this.audioProcessor = null;
        this.isRecording = false;
        this.isConnected = false;
        this.connectionAttempts = 0;
        this.maxConnectionAttempts = 2; // Reduced retry attempts
        this.isSessionStarting = false;
        this.currentAudioSource = null; // Track current playing audio
        this.audioQueue = []; // Queue for audio responses
        this.isPlayingAudio = false;
        this.lastAudioSequenceId = 0; // Track sequence to prevent duplicates
        this.initializeElements();
        this.setupEventListeners();
    }

    initializeElements() {
        this.startBtn = document.getElementById('startBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.interruptBtn = document.getElementById('interruptBtn');
        this.statusIndicator = document.getElementById('statusIndicator');
        this.statusText = document.getElementById('statusText');
        this.audioVisualizer = document.getElementById('audioVisualizer');
        this.transcriptContent = document.querySelector('.transcript-content');
        this.sessionToggleButton = document.getElementById('sessionToggleButton');

        // Validate required elements
        if (!this.sessionToggleButton) {
            console.error('Critical: sessionToggleButton element not found');
        }
    }

    setupEventListeners() {
        if (!this.sessionToggleButton) {
            console.error('sessionToggleButton element not found');
            return;
        }

        this.sessionToggleButton.addEventListener('click', async (event) => {
            event.preventDefault();

            // Prevent multiple clicks during transition
            if (this.sessionToggleButton.disabled || this.isSessionStarting) return;

            this.sessionToggleButton.disabled = true;

            try {
                if (this.isRecording) {
                    await this.stopSession();
                } else {
                    this.isSessionStarting = true;
                    await this.startSession();
                    this.isSessionStarting = false;
                }
            } catch (error) {
                console.error('Session toggle error:', error);
                this.updateStatus('Connection failed', 'error');
                this.isSessionStarting = false;
            } finally {
                this.sessionToggleButton.disabled = false;
            }
        });

        // Theme toggle switch event listener
        const toggleSwitch = document.getElementById('toggle');
        if (toggleSwitch) {
            toggleSwitch.addEventListener('change', (event) => {
                if (event.target.checked) {
                    document.body.classList.add('dark-mode');
                } else {
                    document.body.classList.remove('dark-mode');
                }
            });
        }

        // Handle page unload to cleanup resources
        window.addEventListener('beforeunload', () => {
            this.cleanup();
        });
    }

    updateSessionButton(isRecording) {
        if (!this.sessionToggleButton) return;

        if (isRecording) {
            this.sessionToggleButton.classList.add('active-session');
            this.sessionToggleButton.setAttribute('aria-label', 'End session');
            this.sessionToggleButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" height="48" width="48" fill="white" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" fill="white"/></svg>';
        } else {
            this.sessionToggleButton.classList.remove('active-session');
            this.sessionToggleButton.setAttribute('aria-label', 'Start session');
            this.sessionToggleButton.innerHTML = '<i class="fas fa-microphone" style="color: white;"></i>';
        }
    }

    showLoadingSpinner() {
        if (!this.sessionToggleButton) return;

        this.sessionToggleButton.innerHTML = `
            <div class="loading-spinner">
                <div></div>
                <div></div>
                <div></div>
                <div></div>
                <div></div>
                <div></div>
                <div></div>
                <div></div>
            </div>
        `;
    }

    async startSession() {
        try {
            this.showLoadingSpinner();
            this.updateStatus('Connecting...', 'connecting');
            this.connectionAttempts = 0;

            // Reset audio management
            this.resetAudioState();

            // Initialize socket connection
            await this.initializeSocket();

            // Start audio capture
            await this.startAudioCapture();

            this.isRecording = true;
            this.updateSessionButton(true);
            this.updateStatus('Ready for voice input', 'connected');

        } catch (error) {
            console.error('Error starting session:', error);
            this.updateStatus('Connection failed', 'error');
            this.updateSessionButton(false);
            await this.cleanup();
            throw error;
        }
    }

    // NEW: Reset audio state
    resetAudioState() {
        this.stopCurrentAudio();
        this.audioQueue = [];
        this.isPlayingAudio = false;
        this.lastAudioSequenceId = 0;
        this.currentAudioSource = null;
    }

    async initializeSocket() {
        return new Promise((resolve, reject) => {
            // Clean up existing socket
            if (this.socket) {
                this.socket.disconnect();
                this.socket = null;
            }

            // Initialize socket connection
            this.socket = io({
                timeout: 10000,
                forceNew: true
            });

            // Connection timeout
            const connectionTimeout = setTimeout(() => {
                this.socket.disconnect();
                reject(new Error('Connection timeout'));
            }, 15000);

            this.socket.on('connect', () => {
                clearTimeout(connectionTimeout);
                console.log('Connected to server');
                this.isConnected = true;
                this.connectionAttempts = 0;
                this.updateStatus('Starting AI...', 'connecting');

                // Start Gemini session
                this.socket.emit('start_session');
                resolve();
            });

            this.socket.on('setup_complete', () => {
                console.log('AI assistant ready');
                // Don't show system message for this
            });

            this.socket.on('session_ready', () => {
                console.log('Session ready for audio');
                // Don't show system message for this
            });

            // FIXED: Handle deduplicated audio responses
            this.socket.on('audio_response', (data) => {
                console.log('Received audio response', data.sequenceId ? `(sequence: ${data.sequenceId})` : '');

                // Check for duplicate sequence IDs
                if (data.sequenceId && data.sequenceId <= this.lastAudioSequenceId) {
                    console.log('Skipping duplicate audio sequence:', data.sequenceId);
                    return;
                }

                // Update last sequence ID
                if (data.sequenceId) {
                    this.lastAudioSequenceId = data.sequenceId;
                }

                // Add to audio queue
                this.audioQueue.push({ audio: data.audio, mimeType: data.mimeType });

                // Process the queue if not already playing
                if (!this.isPlayingAudio) {
                    this.processAudioQueue();
                }
            });

            this.socket.on('text_response', (data) => {
                console.log('Text response:', data.text);
                this.addToTranscript('assistant', data.text);
            });

            this.socket.on('turn_complete', () => {
                console.log('Response complete');
                // Don't change speaking indicator here - let audio completion handle it
            });

            this.socket.on('api_error', (error) => {
                console.error('API error:', error);
                this.updateStatus('AI Error: ' + (error.message || 'Unknown error'), 'error');
                // Only show critical errors to user
                if (error.message && (error.message.includes('quota') || error.message.includes('key'))) {
                    this.addToTranscript('system', 'API Error: ' + error.message);
                }
            });

            this.socket.on('error', (error) => {
                clearTimeout(connectionTimeout);
                console.error('Socket error:', error);
                this.updateStatus('Connection error', 'error');
                reject(new Error(error.message || 'Connection error'));
            });

            this.socket.on('connection_closed', (data) => {
                console.log('Connection closed:', data);

                // Only show user-friendly messages for specific errors
                if (data.code === 1007) {
                    this.updateStatus('Configuration error', 'error');
                } else if (data.code === 1008) {
                    this.updateStatus('Authentication failed', 'error');
                    this.addToTranscript('system', 'Please check your API key configuration');
                } else if (data.code !== 1000) {
                    this.updateStatus('Connection lost', 'error');
                }

                // Don't auto-retry for client disconnect or invalid format
                if (data.code !== 1000 && data.code !== 1007) {
                    this.handleConnectionFailure();
                } else {
                    // Stop session for critical errors
                    this.stopSession();
                }
            });

            this.socket.on('disconnect', (reason) => {
                clearTimeout(connectionTimeout);
                console.log('Disconnected:', reason);
                this.isConnected = false;

                // Don't show UI messages for normal disconnects
                if (reason !== 'client namespace disconnect' && reason !== 'io client disconnect') {
                    this.updateStatus('Disconnected', 'disconnected');
                    this.handleConnectionFailure();
                }
            });

            this.socket.on('connect_error', (error) => {
                clearTimeout(connectionTimeout);
                console.error('Connection error:', error);
                reject(new Error('Connection failed: ' + error.message));
            });

            this.socket.on('audio_interrupted', () => {
                console.log('Audio playback interrupted by server');
                this.handleAudioInterruption();
            });
        });
    }

    async processAudioQueue() {
        if (this.audioQueue.length === 0 || this.isPlayingAudio) {
            return;
        }

        this.isPlayingAudio = true;
        const { audio, mimeType } = this.audioQueue.shift(); // Get the next audio item

        try {
            await this.playAudioResponse(audio, mimeType);
        } catch (error) {
            console.error('Audio playback failed:', error);
            this.handleAudioError(error, 'response');
        } finally {
            this.isPlayingAudio = false;
            // Process the next item in the queue
            if (this.audioQueue.length > 0) {
                this.processAudioQueue();
            } else {
                this.showSpeakingIndicator(false);
                this.updateStatus('Ready for voice input', 'connected');
            }
        }
    }

    // NEW: Handle audio interruption
    handleAudioInterruption() {
        console.log('Audio playback interrupted by server');
        this.stopCurrentAudio();
        this.audioQueue = []; // Clear queue to prevent playing stale responses
        this.showSpeakingIndicator(false);
        this.updateStatus('Ready for voice input', 'connected');
    }

    // IMPROVED: Stop current audio more effectively
    stopCurrentAudio() {
        // Stop HTML5 audio elements
        const audioElements = document.querySelectorAll('audio');
        audioElements.forEach(audio => {
            if (!audio.paused) {
                audio.pause();
                audio.currentTime = 0;
            }
            audio.src = ''; // Clear source to prevent further playback
            audio.remove(); // Remove from DOM
        });

        // Stop Web Audio API sources
        if (this.currentAudioSource) {
            try {
                this.currentAudioSource.stop();
                this.currentAudioSource.disconnect();
            } catch (error) {
                console.log('Audio source already stopped or disconnected');
            }
            this.currentAudioSource = null;
        }

        // Close playback audio context if it exists
        if (this.playbackAudioContext && this.playbackAudioContext.state !== 'closed') {
            try {
                this.playbackAudioContext.close();
            } catch (error) {
                console.warn('Playback audio context close warning:', error);
            }
            this.playbackAudioContext = null;
        }

        this.isPlayingAudio = false;
    }

    // NEW: Play audio response with proper management
    async playAudioResponse(audioData, mimeType = 'audio/wav') {
        this.stopCurrentAudio(); // Ensure no other audio is playing
        this.isPlayingAudio = true;
        this.showSpeakingIndicator(true);

        try {
            await this.playAudio(audioData, mimeType);
            console.log('Audio playback completed');
        } catch (error) {
            console.error('Audio playback failed:', error);
            this.handleAudioError(error, 'response');
            throw error; // Re-throw to let processAudioQueue handle the cleanup
        } finally {
            this.isPlayingAudio = false;
            this.showSpeakingIndicator(false);
        }
    }

    handleConnectionFailure() {
        // Don't spam with reconnection attempts - just fail gracefully
        if (this.connectionAttempts < this.maxConnectionAttempts && this.isRecording && !this.isSessionStarting) {
            this.connectionAttempts++;
            console.log(`Attempting to reconnect (${this.connectionAttempts}/${this.maxConnectionAttempts})`);

            setTimeout(async () => {
                try {
                    if (this.isRecording) { // Only reconnect if still supposed to be recording
                        await this.initializeSocket();
                    }
                } catch (error) {
                    console.error('Reconnection failed:', error);
                    this.stopSession();
                }
            }, 1000);
        } else {
            this.stopSession();
        }
    }

    showSpeakingIndicator(speaking) {
        // You can add visual indicator here instead of transcript spam
        if (this.statusIndicator) {
            if (speaking) {
                this.statusIndicator.classList.add('speaking');
                this.updateStatus('Speaking...', 'connected');
            } else {
                this.statusIndicator.classList.remove('speaking');
                this.updateStatus('Ready for voice input', 'connected');
            }
        }
    }

    async startAudioCapture() {
        try {
            this.audioStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 16000
            });

            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            const source = this.audioContext.createMediaStreamSource(this.audioStream);

            if (this.audioContext.audioWorklet) {
                await this.setupAudioWorklet(source);
            } else {
                this.setupScriptProcessor(source);
            }

            console.log('Audio capture started');

        } catch (error) {
            console.error('Microphone error:', error);
            let errorMessage = 'Microphone access denied';

            if (error.name === 'NotAllowedError') {
                errorMessage = 'Please allow microphone access';
                this.addToTranscript('system', 'Microphone permission needed - please allow access and try again');
            } else if (error.name === 'NotFoundError') {
                errorMessage = 'No microphone found';
                this.addToTranscript('system', 'No microphone detected');
            } else if (error.name === 'NotReadableError') {
                errorMessage = 'Microphone in use by another app';
                this.addToTranscript('system', 'Microphone is being used by another application');
            }

            this.updateStatus(errorMessage, 'error');
            throw new Error(errorMessage);
        }
    }

    async setupAudioWorklet(source) {
        try {
            const workletCode = `
                class AudioProcessor extends AudioWorkletProcessor {
                    constructor() {
                        super();
                        this.bufferSize = 1024;
                        this.buffer = [];
                    }

                    process(inputs, outputs, parameters) {
                        const input = inputs[0];
                        if (input && input[0] && input[0].length > 0) {
                            this.buffer.push(...input[0]);
                            
                            if (this.buffer.length >= this.bufferSize) {
                                this.port.postMessage({
                                    audioData: this.buffer.slice()
                                });
                                this.buffer = [];
                            }
                        }
                        return true;
                    }
                }
                
                registerProcessor('audio-processor', AudioProcessor);
            `;

            const workletBlob = new Blob([workletCode], { type: 'application/javascript' });
            const workletURL = URL.createObjectURL(workletBlob);

            await this.audioContext.audioWorklet.addModule(workletURL);

            this.audioProcessor = new AudioWorkletNode(this.audioContext, 'audio-processor');
            source.connect(this.audioProcessor);

            this.audioProcessor.port.onmessage = (event) => {
                this.handleAudioData(event.data.audioData);
            };

            URL.revokeObjectURL(workletURL);
            console.log('AudioWorklet setup successful');

        } catch (error) {
            console.warn('AudioWorklet failed, using fallback');
            this.setupScriptProcessor(source);
        }
    }

    setupScriptProcessor(source) {
        this.audioProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
        source.connect(this.audioProcessor);
        this.audioProcessor.connect(this.audioContext.destination);

        this.audioProcessor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            this.handleAudioData(inputData);
        };

        console.log('ScriptProcessor setup as fallback');
    }

    handleAudioData(audioData) {
        if (!this.isRecording || !this.socket || !this.socket.connected) {
            return;
        }

        try {
            // Convert float32 to int16 with proper clamping
            const int16Data = new Int16Array(audioData.length);
            for (let i = 0; i < audioData.length; i++) {
                const sample = Math.max(-1, Math.min(1, audioData[i]));
                int16Data[i] = sample * 0x7FFF;
            }

            // Send audio data to server
            this.socket.emit('audio_data', Array.from(int16Data));

            // Update visualizer
            this.updateVisualizer(audioData);

        } catch (error) {
            console.error('Audio processing error:', error);
        }
    }

    updateVisualizer(audioData) {
        if (!this.audioVisualizer) return;

        const waves = this.audioVisualizer.querySelectorAll('.wave');
        if (waves.length === 0) return;

        // Calculate RMS volume
        const rms = Math.sqrt(audioData.reduce((sum, val) => sum + val * val, 0) / audioData.length);
        const normalizedVolume = Math.min(rms * 8, 1); // Reduced sensitivity
        const baseHeight = 20;
        const maxVariation = 30;

        waves.forEach((wave, index) => {
            const variation = (Math.random() * 0.5 + 0.7) * normalizedVolume;
            const height = baseHeight + (variation * maxVariation);

            wave.style.transition = 'height 0.2s ease-out';
            wave.style.height = Math.max(baseHeight, height) + 'px';

            if (normalizedVolume > 0.02) {
                wave.classList.add('active');
            } else {
                wave.classList.remove('active');
            }
        });
    }

    // IMPROVED AUDIO PLAYBACK METHODS
    async playAudio(audioData, mimeType = 'audio/wav') {
        const startTime = performance.now();
        console.log(`Starting audio playback at ${startTime.toFixed(2)}ms, mimeType: ${mimeType}, data length: ${audioData.length}`);

        try {
            console.log('Playing audio, mimeType:', mimeType, 'data length:', audioData.length);

            // Decode base64 audio data
            const binaryString = atob(audioData);
            const audioBuffer = new Uint8Array(binaryString.length);

            for (let i = 0; i < binaryString.length; i++) {
                audioBuffer[i] = binaryString.charCodeAt(i);
            }

            // Prioritize Web Audio API for PCM data and fallback scenarios
            if (mimeType && (mimeType.includes('pcm') || mimeType.includes('raw'))) {
                console.log('PCM data detected, using Web Audio API directly');
                await this.playWithWebAudioAPI(audioBuffer, mimeType);
                return;
            }

            // Try HTML5 Audio first for encoded formats, but with shorter timeout
            try {
                await this.playWithHTMLAudio(audioBuffer, mimeType);
                console.log('HTML5 Audio playback successful');
            } catch (htmlError) {
                console.warn('HTML5 Audio failed:', htmlError.message);
                // Immediately fallback to Web Audio API
                await this.playWithWebAudioAPI(audioBuffer, mimeType);
            }
            const endTime = performance.now();
            console.log(`Audio playback finished at ${endTime.toFixed(2)}ms, duration: ${(endTime - startTime).toFixed(2)}ms`);
        } catch (error) {
            console.error('Audio playback error:', error);
            throw error;
        }
    }

    async playWithHTMLAudio(audioBuffer, mimeType, timeout = 3000) {
        return new Promise((resolve, reject) => {
            const audio = new Audio();
            let timeoutId;
            let resolved = false;

            const cleanup = () => {
                if (timeoutId) clearTimeout(timeoutId);
                resolved = true;
            };

            const handleSuccess = () => {
                if (resolved) return;
                cleanup();
                console.log('HTML5 Audio loaded and playing');
                resolve();
            };

            const handleError = (error) => {
                if (resolved) return;
                cleanup();
                URL.revokeObjectURL(audio.src);
                reject(new Error(`HTML5 Audio failed: ${error.message || 'Unknown error'}`));
            };

            // Set up timeout
            timeoutId = setTimeout(() => {
                handleError(new Error('Timeout'));
            }, timeout);

            // Create audio blob and URL
            const audioBlob = new Blob([audioBuffer], { type: mimeType });
            const audioUrl = URL.createObjectURL(audioBlob);

            // Set up event listeners
            audio.onloadeddata = () => {
                console.log('HTML5 Audio data loaded');
            };

            audio.oncanplaythrough = async () => {
                if (resolved) return;
                console.log('HTML5 Audio ready to play');

                try {
                    await audio.play();
                    handleSuccess();
                } catch (playError) {
                    handleError(playError);
                }
            };

            audio.onerror = (e) => {
                const errorMsg = audio.error ?
                    `Code: ${audio.error.code}, Message: ${audio.error.message}` :
                    'Unknown audio error';
                handleError(new Error(errorMsg));
            };

            audio.onended = () => {
                URL.revokeObjectURL(audioUrl);
                console.log('HTML5 Audio playback completed');
            };

            // Start loading
            audio.src = audioUrl;
            audio.load(); // Explicitly trigger loading
        });
    }

    async playWithWebAudioAPI(audioBuffer, mimeType) {
        try {
            console.log('Using Web Audio API for playback');

            // Ensure playback context exists and is running
            if (!this.playbackAudioContext || this.playbackAudioContext.state === 'closed') {
                this.playbackAudioContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            if (this.playbackAudioContext.state === 'suspended') {
                await this.playbackAudioContext.resume();
            }

            let audioBufferSource;

            // Handle PCM data
            if (mimeType && (mimeType.includes('pcm') || mimeType.includes('raw'))) {
                audioBufferSource = await this.createAudioBufferFromPCMData(audioBuffer, mimeType);
            } else {
                // Try to decode encoded audio data
                try {
                    const arrayBuffer = audioBuffer.buffer.slice(
                        audioBuffer.byteOffset,
                        audioBuffer.byteOffset + audioBuffer.byteLength
                    );
                    audioBufferSource = await this.playbackAudioContext.decodeAudioData(arrayBuffer);
                    console.log('Successfully decoded audio data');
                } catch (decodeError) {
                    console.warn('decodeAudioData failed, treating as PCM:', decodeError.message);
                    // Fallback to PCM interpretation
                    audioBufferSource = await this.createAudioBufferFromPCMData(audioBuffer, 'audio/pcm;rate=24000');
                }
            }

            // Create and configure buffer source
            const source = this.playbackAudioContext.createBufferSource();
            source.buffer = audioBufferSource;

            // Add some gain control to prevent clipping
            const gainNode = this.playbackAudioContext.createGain();
            gainNode.gain.value = 0.8; // Slightly reduce volume to prevent distortion

            source.connect(gainNode);
            gainNode.connect(this.playbackAudioContext.destination);

            // Set up completion handler
            return new Promise((resolve) => {
                source.onended = () => {
                    console.log('Web Audio API playback completed');
                    resolve();
                };

                source.start(0);
                console.log('Web Audio API playback started');
            });

        } catch (error) {
            console.error('Web Audio API playback failed:', error);
            throw error;
        }
    }

    async createAudioBufferFromPCMData(audioBuffer, mimeType) {
        // Extract parameters from mimeType
        const sampleRateMatch = mimeType.match(/rate=(\d+)/);
        const sampleRate = sampleRateMatch ? parseInt(sampleRateMatch[1]) : 24000;

        const bitsMatch = mimeType.match(/(\d+)bit/) || mimeType.match(/bits=(\d+)/);
        const bits = bitsMatch ? parseInt(bitsMatch[1]) : 16;

        console.log(`🔧 Creating AudioBuffer from PCM: ${bits}-bit, ${sampleRate}Hz`);

        // Convert audio data based on bit depth
        let pcmData;
        if (bits === 16) {
            // 16-bit signed PCM
            pcmData = new Int16Array(
                audioBuffer.buffer,
                audioBuffer.byteOffset,
                audioBuffer.byteLength / 2
            );
        } else if (bits === 32) {
            // 32-bit float PCM
            pcmData = new Float32Array(
                audioBuffer.buffer,
                audioBuffer.byteOffset,
                audioBuffer.byteLength / 4
            );
        } else {
            // Default to 16-bit
            console.warn(`Unsupported bit depth ${bits}, defaulting to 16-bit`);
            pcmData = new Int16Array(
                audioBuffer.buffer,
                audioBuffer.byteOffset,
                audioBuffer.byteLength / 2
            );
        }

        // Create AudioBuffer for mono audio
        const audioBufferResult = this.playbackAudioContext.createBuffer(1, pcmData.length, sampleRate);
        const channelData = audioBufferResult.getChannelData(0);

        // Convert to Float32 range [-1.0, 1.0]
        if (bits === 16) {
            for (let i = 0; i < pcmData.length; i++) {
                channelData[i] = Math.max(-1, Math.min(1, pcmData[i] / 32768));
            }
        } else if (bits === 32) {
            // Already in float format, just copy with clamping
            for (let i = 0; i < pcmData.length; i++) {
                channelData[i] = Math.max(-1, Math.min(1, pcmData[i]));
            }
        }

        console.log(`AudioBuffer created: ${audioBufferResult.length} samples, ${audioBufferResult.duration.toFixed(2)}s`);
        return audioBufferResult;
    }

    // Enhanced error handling for connection issues
    handleAudioError(error, context = 'playback') {
        console.error(`Audio ${context} error:`, error);

        // Categorize errors for better user feedback
        if (error.message.includes('DEMUXER_ERROR') || error.message.includes('no supported source')) {
            this.updateStatus('Audio format not supported', 'error');
            this.addToTranscript('system', 'Audio format issue - using alternative playback method');
        } else if (error.message.includes('timeout') || error.message.includes('Timeout')) {
            this.updateStatus('Audio loading timeout', 'error');
        } else if (error.message.includes('decodeAudioData')) {
            console.log('Audio decoding failed, trying PCM fallback');
        } else {
            this.updateStatus('Audio playback error', 'error');
        }
    }

    // Optional: Add audio format detection
    detectAudioFormat(audioBuffer) {
        // Check for common audio file signatures
        const header = Array.from(audioBuffer.slice(0, 12))
            .map(b => String.fromCharCode(b))
            .join('');

        if (header.includes('RIFF') && header.includes('WAVE')) {
            return 'audio/wav';
        } else if (audioBuffer[0] === 0xFF && (audioBuffer[1] & 0xE0) === 0xE0) {
            return 'audio/mpeg';
        } else if (header.includes('OggS')) {
            return 'audio/ogg';
        } else if (header.slice(4, 8) === 'ftyp') {
            return 'audio/mp4';
        }

        // Default to PCM if no signature found
        return 'audio/pcm;rate=24000;bits=16';
    }

    interrupt() {
        if (this.socket && this.socket.connected) {
            this.socket.emit('interrupt');
            console.log('Interrupted conversation');
        }
    }

    async stopSession() {
        console.log('Stopping session...');

        this.isRecording = false;
        this.isSessionStarting = false;
        this.updateSessionButton(false);
        this.updateStatus('Disconnecting...', 'disconnecting');

        await this.cleanup();

        this.updateStatus('Disconnected', 'disconnected');

        // Reset visualizer
        if (this.audioVisualizer) {
            const waves = this.audioVisualizer.querySelectorAll('.wave');
            waves.forEach(wave => {
                wave.style.height = '20px';
                wave.classList.remove('active');
            });
        }
    }

    async cleanup() {
        // Stop audio stream
        if (this.audioStream) {
            this.audioStream.getTracks().forEach(track => {
                track.stop();
            });
            this.audioStream = null;
        }

        // Close audio context
        if (this.audioContext && this.audioContext.state !== 'closed') {
            try {
                await this.audioContext.close();
            } catch (error) {
                console.warn('Audio context close warning:', error);
            }
            this.audioContext = null;
        }

        // Close playback audio context - IMPROVED
        if (this.playbackAudioContext && this.playbackAudioContext.state !== 'closed') {
            try {
                // Stop all sources before closing
                const currentTime = this.playbackAudioContext.currentTime;
                await this.playbackAudioContext.close();
            } catch (error) {
                console.warn('Playback audio context close warning:', error);
            }
            this.playbackAudioContext = null;
        }

        // Disconnect socket
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }

        this.audioProcessor = null;
        this.isConnected = false;
        this.connectionAttempts = 0;
    }

    updateStatus(text, type) {
        if (this.statusText) {
            this.statusText.textContent = text;
        }

        if (this.statusIndicator) {
            const statusDot = this.statusIndicator.querySelector('.status-dot');
            if (statusDot) {
                statusDot.className = 'status-dot';
                if (type === 'connected') {
                    statusDot.classList.add('active');
                } else if (type === 'error') {
                    statusDot.classList.add('error');
                }
            }
        }

        console.log(`Status: ${text} (${type})`);
    }

    addToTranscript(speaker, text) {
        if (!this.transcriptContent) return;

        const timestamp = new Date().toLocaleTimeString();
        const message = document.createElement('div');
        message.className = `transcript-item ${speaker}`;

        const speakerIcon = {
            'system': '⚙️',
            'user': '👤',
            'assistant': '🤖'
        };

        // Only show important system messages, filter out connection spam
        if (speaker === 'system') {
            // Only show critical system messages
            if (!text.includes('Session started') &&
                !text.includes('Session ended') &&
                !text.includes('AI assistant ready') &&
                !text.includes('Audio capture started') &&
                !text.includes('Response complete') &&
                !text.includes('Speaking...') &&
                !text.includes('Disconnected:') &&
                !text.includes('Connection closed:')) {

                message.innerHTML = `
                    <div class="transcript-header">
                        <span class="speaker-icon">${speakerIcon[speaker]}</span>
                        <span class="speaker-name">${speaker.toUpperCase()}</span>
                        <span class="timestamp">${timestamp}</span>
                    </div>
                    <div class="transcript-text">${text}</div>
                `;

                this.transcriptContent.appendChild(message);
                this.transcriptContent.scrollTop = this.transcriptContent.scrollHeight;
            }
        } else {
            // Show all user and assistant messages
            message.innerHTML = `
                <div class="transcript-header">
                    <span class="speaker-icon">${speakerIcon[speaker]}</span>
                    <span class="speaker-name">${speaker.toUpperCase()}</span>
                    <span class="timestamp">${timestamp}</span>
                </div>
                <div class="transcript-text">${text}</div>
            `;

            this.transcriptContent.appendChild(message);
            this.transcriptContent.scrollTop = this.transcriptContent.scrollHeight;
        }
    }

    // Optional: Add audio quality indicators to your status updates
    updateAudioStatus(quality = 'good') {
        const qualityIndicators = {
            good: '🔊',
            fair: '🔉',
            poor: '🔈',
            muted: '🔇'
        };

        const indicator = qualityIndicators[quality] || '🔊';
        this.updateStatus(`${indicator} Audio ${quality}`, 'connected');
    }

    // Add this method to handle different types of audio errors gracefully
    handleConnectionAudioIssues() {
        // If audio keeps failing, suggest alternatives to the user
        this.addToTranscript('system', 'If you\'re having audio issues, try:');
        this.addToTranscript('system', '• Refreshing the page');
        this.addToTranscript('system', '• Checking your browser\'s audio permissions');
        this.addToTranscript('system', '• Using a different browser');
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    try {
        const app = new VoiceChatApp();
        console.log('VoiceChatApp initialized');

        // Make app globally available for debugging
        window.voiceChatApp = app;
    } catch (error) {
        console.error('Failed to initialize VoiceChatApp:', error);
    }
});