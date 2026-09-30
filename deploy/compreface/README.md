# Local CompreFace

Requires Docker Desktop running Linux containers through WSL 2. Install prerequisites from https://docs.docker.com/desktop/setup/install/windows-install/ and restart Windows if requested.

From the project directory:

```powershell
powershell -ExecutionPolicy Bypass -File deploy/compreface/start.ps1
```

The script generates a private database password in an ignored `.env` file and starts a separate CompreFace 1.2.0 stack. First startup downloads large container images. Open http://localhost:8000 and create an administrator, application, Face Detection service and Face Verification service. Do not use the Recognition service key in their place.

The interface listens only on this PC. PostgreSQL is not published. Data survives container restarts in the `bluecoree-face_face-db` Docker volume. Back up that volume and the generated `.env`; do not run `down -v` unless intentionally deleting registrations and configuration.

Check containers with `docker compose -f deploy/compreface/compose.yaml ps`. Stop with `docker compose -f deploy/compreface/compose.yaml stop`.

This does not yet connect the live Vercel site: localhost on Vercel is not this PC. A stable authenticated HTTPS tunnel or reverse proxy must expose only the necessary API paths, not the administration interface. The PC and Docker must remain on and connected during attendance hours. The app's adapter also requires a separate real liveness service; CompreFace does not supply one. See ../../docs/compreface.md for server-only environment settings and activation checks. Do not disable liveness to make setup appear complete.
