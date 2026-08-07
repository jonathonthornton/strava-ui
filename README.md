# Strava Activities Explorer

A simple dark-themed HTML/JavaScript app for experimenting with a Strava-like activities endpoint.

## Run it

Start the local proxy server:

```bash
python3 server.py
```

Then open http://127.0.0.1:8000/index.html in your browser.

## Notes

- The app now uses a local proxy so standalone browsers can reach the remote activities API without CORS issues.
- The proxy forwards requests from `/proxy/<encoded-url>` to the backend.
