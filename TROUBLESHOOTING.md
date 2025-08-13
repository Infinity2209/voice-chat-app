# Port Conflict Resolution Guide

## Problem
The server and frontend are trying to use the same port (3002), causing conflicts.

## Solution

### Quick Fix
1. **Change the port** by setting the PORT environment variable:
   ```bash
   # Windows Command Prompt
   set PORT=3003 && npm start

   # Windows PowerShell
   $env:PORT=3003; npm start

   # Linux/Mac
   PORT=3003 npm start
   ```

### Check Port Usage
To see which process is using port 3002:
```bash
# Windows
netstat -ano | findstr :3002
tasklist | findstr [PID]

# Linux/Mac
lsof -i :3002
```

### Available Ports
Try these common alternative ports:
- 3000, 3001, 3003, 8080, 8000, 5000

### Environment Setup
1. Copy `.env.example` to `.env`
2. Update the PORT value in `.env`
3. Run the server normally

### Frontend Connection
The frontend automatically connects to the same port as the server, so no additional changes are needed when changing the server port.
