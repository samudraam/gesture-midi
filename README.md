# Gesture Music Controller

A web-based music sequencer controlled by hand gestures using MediaPipe and Tone.js.

## Features

- **Gesture Control**: Use hand gestures to control music patterns
- **Multi-Instrument Support**: Kick, Closed Hihat, Open Hihat, and Snare
- **Real-time Pattern Editing**: Pinch beats on the circle to toggle them
- **BPM Control**: Adjust tempo with the vertical slider
- **Visual Feedback**: See your hand tracking and beat patterns in real-time

## Gestures

- **Pinch**: Toggle beats for the selected instrument
- **Pointer Finger (1 finger)**: Pause the sequence
- **Peace Sign (2 fingers)**: Stop the sequence

## Instruments

- **Kick**: Low C1 note
- **Closed Hihat**: Short, tight white noise
- **Open Hihat**: Longer, sustained white noise  
- **Snare**: Higher C2 note

## How to Use

1. Click "Start" to begin
2. Select an instrument by clicking the buttons on the right
3. Pinch beats on the circle to toggle them on/off
4. Use gestures to control playback
5. Adjust BPM with the vertical slider on the left

## Technologies

- **Tone.js**: Web audio synthesis
- **MediaPipe**: Hand gesture recognition
- **HTML5 Canvas**: Visual rendering
- **Vanilla JavaScript**: Core functionality

## Live Demo

[View on GitHub Pages](https://yourusername.github.io/nataliev2)

## Development

To run locally:

```bash
# Start a local server
python3 -m http.server 8000

# Or with Node.js
npx serve .
```

Then open `http://localhost:8000` in your browser.

## Browser Requirements

- Modern browser with Web Audio API support
- Camera access for hand tracking
- HTTPS required for camera access in production
