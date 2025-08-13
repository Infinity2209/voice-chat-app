const WebSocket = require('ws');

const GEMINI_API_KEY = 'AIzaSyBdFlveln-zKu3dynlvCdGBB02CbzUN24s';
const GEMINI_API_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

console.log('Testing Gemini API connection...');

const wsUrl = `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`;
console.log('Connecting to:', wsUrl.replace(GEMINI_API_KEY, '***'));

const ws = new WebSocket(wsUrl);

ws.on('open', () => {
    console.log('✅ Successfully connected to Gemini API!');
    
    const setupMessage = {
        setup: {
            model: "models/gemini-2.5-flash-preview-native-audio-dialog",
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
                    text: "You are a helpful assistant for Revolt Motors."
                }]
            }
        }
    };
    
    console.log('Sending setup message...');
    ws.send(JSON.stringify(setupMessage));
});

ws.on('message', (data) => {
    console.log('📨 Received message from Gemini:', data.toString());
});

ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error.message);
});

ws.on('close', (code, reason) => {
    console.log(`🔴 Connection closed. Code: ${code}, Reason: ${reason}`);
});

setTimeout(() => {
    console.log('Closing test connection...');
    ws.close();
}, 10000);
