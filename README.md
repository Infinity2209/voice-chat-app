# Revolt Motors Voice Assistant

A real-time conversational voice interface built using Gemini Live API that replicates the functionality of the Revolt Motors chatbot.

## Features

- **Real-time voice conversation** with low latency (1-2 seconds)
- **User interruption capability** - users can interrupt the AI mid-response
- **Clean, functional UI** with audio visualization
- **Server-to-server architecture** using Node.js/Express
- **WebSocket-based communication** for real-time audio streaming
- **System instructions** focused on Revolt Motors topics

## Architecture

- **Frontend**: Vanilla HTML/CSS/JavaScript with Socket.io client
- **Backend**: Node.js/Express with Socket.io server
- **Audio Processing**: Web Audio API for real-time audio capture
- **AI Integration**: Gemini Live API with native audio dialog model

## Setup Instructions

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn
- Google Gemini API key

### Installation

1. Clone the repository:
```bash
git clone [your-repo-url]
cd revolt-voice-chat
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file and add your Gemini API key:
```bash
GEMINI_API_KEY=your_actual_api_key_here
PORT=3000
```

4. Start the server:
```bash
npm start
```

5. Open your browser and navigate to:
```
http://localhost:3000
```

### Development Mode
For development with auto-restart:
```bash
npm run dev
```

## Usage

1. **Start the session**: Click the "Start" button to begin
2. **Allow microphone access**: Grant permission when prompted
3. **Start speaking**: Begin your conversation with the AI
4. **Interrupt anytime**: Click "Interrupt" or simply start speaking to interrupt the AI
5. **End session**: Click "Stop" to end the conversation

## Technical Details

### API Configuration
- **Model**: `gemini-2.5-flash-preview-native-audio-dialog`
- **Audio Format**: PCM 16-bit, 16kHz mono
- **Latency Target**: 1-2 seconds response time
- **Interruption**: Native support via Gemini Live API

### System Instructions
The AI is configured to only discuss topics related to:
- Revolt Motors electric motorcycles
- Features and specifications
- Pricing and availability
- Company information
- Related topics only

### File Structure
```
├── server.js          # Express server with Socket.io
├── public/
│   ├── index.html     # Main UI
│   ├── styles.css     # CSS styling
│   └── app.js         # Frontend JavaScript
├── package.json       # Dependencies
├── .env              # Environment variables
└── README.md         # This file
```

## Troubleshooting

### Common Issues

1. **Microphone not working**:
   - Ensure HTTPS is used (required for getUserMedia)
   - Check browser permissions
   - Try refreshing the page

2. **API connection errors**:
   - Verify your Gemini API key is correct
   - Check internet connection
   - Review server logs for detailed error messages

3. **Audio quality issues**:
   - Ensure stable internet connection
   - Check browser compatibility
   - Try using headphones for better audio quality

### Browser Compatibility
- Chrome 66+
- Firefox 60+
- Safari 11+
- Edge 79+

## Demo

A demo video showing the application in action is available at:
[Google Drive link to be added]

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is created for assessment purposes. All rights reserved.
