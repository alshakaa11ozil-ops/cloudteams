// =============================================================================
// src/controllers/twoFactor.controller.ts
// PURPOSE: Thin HTTP layer for all 2FA endpoints. Reads req, calls service,
//          sends res. No business logic here.
//
// ROUTES HANDLED:
//   POST /api/auth/2fa/setup          → start 2FA setup (get QR code)
//   POST /api/auth/2fa/verify-setup   → confirm QR scan, enable 2FA
//   POST /api/auth/2fa/login          → complete login with 2FA code
//   POST /api/auth/2fa/disable        → turn off 2FA
//
// ERROR MAPPING:
//   InvalidTwoFactorCodeError    → 400
//   TwoFactorNotEnabledError     → 400
//   TwoFactorAlreadyEnabledError → 400
//   UserNotFoundError            → 404
//   Everything else              → 500
// =============================================================================

import { Request, Response } from "express";
import {
    generateSetupData,
    verifySetupAndEnable,
    completeTwoFactorLogin,
    disableTwoFactor,
    InvalidTwoFactorCodeError,
    TwoFactorNotEnabledError,
    TwoFactorAlreadyEnabledError,
    UserNotFoundError,
} from "../services/twoFactor.service";

// ---------------------------------------------------------------------------
// CONTROLLER 1: setupTwoFactorHandler
// ---------------------------------------------------------------------------
// PURPOSE: Generate a secret + QR code for the authenticated user.
//          Does NOT enable 2FA yet — user must confirm first.
//
// ROUTE:  POST /api/auth/2fa/setup
// AUTH:   Required (authenticate middleware)
//
// RESPONSE 200:
//   {
//     secret: "JBSWY3DPEHPK3PXP",        ← backup code shown to user
//     qrCodeDataUrl: "data:image/png;base64,..."  ← render as <img src=...>
//   }
// ---------------------------------------------------------------------------
export const setupTwoFactorHandler = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const { secret, qrCodeDataUrl } = await generateSetupData(
            req.user!.userId
        );

        res.status(200).json({
            message: "Scan this QR code with Google Authenticator, then call /2fa/verify-setup with the 6-digit code",
            secret,       // show this as a manual backup entry option
            qrCodeDataUrl // frontend renders: <img src={qrCodeDataUrl} />
        });
    } catch (err) {
        if (err instanceof TwoFactorAlreadyEnabledError) {
            res.status(400).json({ error: err.message });
            return;
        }
        if (err instanceof UserNotFoundError) {
            res.status(404).json({ error: err.message });
            return;
        }
        console.error("[setupTwoFactorHandler]", err);
        res.status(500).json({ error: "Internal server error" });
    }
};

// ---------------------------------------------------------------------------
// CONTROLLER 2: verifySetupHandler
// ---------------------------------------------------------------------------
// PURPOSE: User submits their first 6-digit code to prove the scan worked.
//          If valid, saves the secret and activates 2FA.
//
// ROUTE:  POST /api/auth/2fa/verify-setup
// AUTH:   Required
//
// BODY:   { secret: string, code: string }
//   secret — the base32 secret returned from /setup
//   code   — the 6-digit code from the authenticator app
//
// WHY SEND secret BACK TO US?
//   We didn't save it to the DB in the setup step. The client held it
//   temporarily. Now we receive it back, verify the code against it,
//   and only then save it. Stateless approach — no server-side session needed.
//
// RESPONSE 200: { message: "2FA enabled successfully" }
// ---------------------------------------------------------------------------
export const verifySetupHandler = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const { secret, code } = req.body;

        // Basic validation — both fields are required
        if (!secret || !code) {
            res.status(400).json({ error: "secret and code are required" });
            return;
        }

        // code should be exactly 6 digits
        if (!/^\d{6}$/.test(code)) {
            res.status(400).json({ error: "code must be exactly 6 digits" });
            return;
        }

        await verifySetupAndEnable(req.user!.userId, secret, code);

        res.status(200).json({ message: "2FA enabled successfully. Your account is now protected." });
    } catch (err) {
        if (err instanceof InvalidTwoFactorCodeError) {
            res.status(400).json({ error: err.message });
            return;
        }
        console.error("[verifySetupHandler]", err);
        res.status(500).json({ error: "Internal server error" });
    }
};

// ---------------------------------------------------------------------------
// CONTROLLER 3: twoFactorLoginHandler
// ---------------------------------------------------------------------------
// PURPOSE: Second step of login for 2FA users. Accepts the tempToken
//          (from the first login step) + the 6-digit code.
//          Returns the real JWT on success.
//
// ROUTE:  POST /api/auth/2fa/login
// AUTH:   NOT required (user isn't authenticated yet — that's the point)
//
// BODY:   { tempToken: string, code: string }
//
// RESPONSE 200: { token, user } — same shape as normal login
// ---------------------------------------------------------------------------
export const twoFactorLoginHandler = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const { tempToken, code } = req.body;

        if (!tempToken || !code) {
            res.status(400).json({ error: "tempToken and code are required" });
            return;
        }

        if (!/^\d{6}$/.test(code)) {
            res.status(400).json({ error: "code must be exactly 6 digits" });
            return;
        }

        const result = await completeTwoFactorLogin(tempToken, code);

        // Same response shape as normal login — client handles both identically
        res.status(200).json({
            message: "Login successful",
            token: result.token,
            user: result.user,
        });
    } catch (err) {
        if (err instanceof InvalidTwoFactorCodeError) {
            // 401 here — this is an authentication failure
            res.status(401).json({ error: err.message });
            return;
        }
        if (err instanceof UserNotFoundError) {
            res.status(404).json({ error: err.message });
            return;
        }
        console.error("[twoFactorLoginHandler]", err);
        res.status(500).json({ error: "Internal server error" });
    }
};

// ---------------------------------------------------------------------------
// CONTROLLER 4: disableTwoFactorHandler
// ---------------------------------------------------------------------------
// PURPOSE: Turn off 2FA. Requires a valid code to confirm the user still
//          controls their authenticator app.
//
// ROUTE:  POST /api/auth/2fa/disable
// AUTH:   Required
//
// BODY:   { code: string }
//
// RESPONSE 200: { message: "2FA disabled" }
// ---------------------------------------------------------------------------
export const disableTwoFactorHandler = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const { code } = req.body;

        if (!code) {
            res.status(400).json({ error: "code is required" });
            return;
        }

        if (!/^\d{6}$/.test(code)) {
            res.status(400).json({ error: "code must be exactly 6 digits" });
            return;
        }

        await disableTwoFactor(req.user!.userId, code);

        res.status(200).json({ message: "2FA has been disabled on your account." });
    } catch (err) {
        if (err instanceof InvalidTwoFactorCodeError) {
            res.status(400).json({ error: err.message });
            return;
        }
        if (err instanceof TwoFactorNotEnabledError) {
            res.status(400).json({ error: err.message });
            return;
        }
        console.error("[disableTwoFactorHandler]", err);
        res.status(500).json({ error: "Internal server error" });
    }
};