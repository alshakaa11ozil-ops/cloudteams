// ============================================================
// socket.ts
// PURPOSE: Sets up Socket.io on top of the existing Express HTTP
//          server. Exports two things:
//            1. initSocket(httpServer) — call once at startup
//            2. getIO()               — call anywhere to emit events
//
// DESIGN DECISION — WHY A SINGLETON:
//   Socket.io's Server instance must be created once and shared.
//   If we created a new instance in every file that needs to emit,
//   we'd have multiple disconnected servers. The singleton pattern
//   (store in a module-level variable, export a getter) gives every
//   file access to the same instance.
//
// HOW ROOMS WORK:
//   When a client connects, it emits 'join-team' with a teamId.
//   The server puts that socket into room 'team-{teamId}'.
//   When we emit to 'team-{teamId}', only sockets in that room
//   receive the event — perfect for team-scoped notifications.
// ============================================================

import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';

// Module-level variable — this is the singleton.
// null until initSocket() is called.
let io: SocketServer | null = null;

// ============================================================
// FUNCTION: initSocket
// PURPOSE:  Create the Socket.io server, attach it to the Express
//           HTTP server, configure CORS, and set up connection
//           handling. Called ONCE in server.ts at startup.
// INPUTS:   httpServer — the http.Server created by server.ts
// OUTPUTS:  The SocketServer instance (also stored in module `io`)
// WHY ATTACH TO HTTP SERVER (not Express app):
//   Socket.io needs the raw Node.js HTTP server, not the Express
//   app, because WebSocket connections are upgraded at the HTTP
//   level before Express sees them. Express handles HTTP;
//   Socket.io handles the WebSocket upgrade on the same port.
// ============================================================
export function initSocket(httpServer: HttpServer): SocketServer {
    io = new SocketServer(httpServer, {
        destroyUpgrade: false, // CRITICAL: Prevent Socket.io from destroying Hocuspocus upgrades!
        cors: {
            origin: process.env.FRONTEND_URL || 'http://localhost:5173',
            methods: ['GET', 'POST'],
        },
    });

    // ── Connection Handler ────────────────────────────────────
    // This callback runs every time a new client connects.
    // 'socket' represents ONE connected client (one browser tab).
    io.on('connection', (socket: Socket) => {
        console.log(`[Socket.io] Client connected: ${socket.id}`);

        // ── Event: join-team ───────────────────────────────────
        // PURPOSE: Put this socket into the correct team room so it
        //          receives team-scoped lock events.
        // The frontend sends this immediately after connecting:
        //   socket.emit('join-team', { teamId: 5 })
        // We validate teamId is a real number before joining.
        socket.on('join-team', (data: { teamId: number }) => {
            if (!data?.teamId || typeof data.teamId !== 'number') {
                // Silently ignore malformed join requests.
                return;
            }

            const room = `team-${data.teamId}`;
            socket.join(room);  // socket is now in this room
            console.log(`[Socket.io] Socket ${socket.id} joined room: ${room}`);
        });

        // ── Event: leave-team ──────────────────────────────────
        // PURPOSE: Remove socket from room when user navigates away.
        // The frontend sends this when unmounting the team view.
        // Not strictly required (disconnect handles cleanup) but
        // good practice for when users switch between teams.
        socket.on('leave-team', (data: { teamId: number }) => {
            if (!data?.teamId) return;

            const room = `team-${data.teamId}`;
            socket.leave(room);
            console.log(`[Socket.io] Socket ${socket.id} left room: ${room}`);
        });

        // ── Event: disconnect ──────────────────────────────────
        // PURPOSE: Log when a client disconnects.
        // Socket.io automatically removes the socket from all rooms
        // on disconnect — we just log it for debugging.
        socket.on('disconnect', (reason: string) => {
            console.log(`[Socket.io] Client disconnected: ${socket.id} — ${reason}`);
        });
    });

    console.log('[Socket.io] Server initialized');
    return io;
}

// ============================================================
// FUNCTION: getIO
// PURPOSE:  Returns the Socket.io server instance so any service
//           or controller can emit events without importing the
//           full server setup.
// INPUTS:   none
// OUTPUTS:  SocketServer instance
// THROWS:   Error if called before initSocket() — prevents silent
//           failures where events would just disappear.
// USAGE (in lock.service.ts):
//   import { getIO } from '../socket';
//   getIO().to(`team-${teamId}`).emit('file.locked', payload);
// ============================================================
export function getIO(): SocketServer {
    if (!io) {
        // This should never happen in production if server.ts is correct.
        // The error message tells you exactly what went wrong and where to fix it.
        throw new Error(
            '[Socket.io] getIO() called before initSocket(). ' +
            'Call initSocket(httpServer) in server.ts first.'
        );
    }
    return io;
}

// ============================================================
// HELPER: emitToTeam
// PURPOSE:  Convenience wrapper so services don't need to know
//           the room naming convention ('team-${teamId}').
//           If Socket.io is not initialized yet, this fails
//           silently — lock operations still work, events just
//           don't broadcast (graceful degradation).
// INPUTS:   teamId  — which team's room to broadcast to
//           event   — event name (e.g. 'file.locked')
//           payload — data to send to all clients in the room
// OUTPUTS:  void
// USAGE:
//   emitToTeam(5, 'file.locked', { fileId: 12, lockedBy: 'Alice' })
// ============================================================
export function emitToTeam(
    teamId: number,
    event: string,
    payload: Record<string, unknown>
): void {
    if (!io) {
        // Socket.io not initialized — skip silently.
        // This can happen during unit tests or if server setup failed.
        console.warn(`[Socket.io] emitToTeam called before init — event '${event}' dropped`);
        return;
    }

    io.to(`team-${teamId}`).emit(event, payload);
}

export function setIo(newIo: SocketServer): void {
    io = newIo;
}

export function getIo(): SocketServer | null {
    return io;
}
