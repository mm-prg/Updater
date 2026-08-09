"use strict";

const UPDATER_ROUTE_PREFIX = "/plugins/Updater";

/**
 * Restrict Updater backend routes to authenticated FM-DX administrators.
 *
 * Hiding the frontend controls is not an authorization boundary: every
 * backend endpoint must enforce the administrator session server-side.
 */
function requireAdminSession(req, res, next) {
    if (req?.session?.isAdminAuthenticated === true) {
        return next();
    }

    return res.status(403).json({
        ok: false,
        error: "Administrator authentication required."
    });
}

function protectUpdaterRoutes(router) {
    if (!router || typeof router.use !== "function") {
        throw new TypeError("An Express router is required.");
    }

    router.use(UPDATER_ROUTE_PREFIX, requireAdminSession);
}

module.exports = {
    UPDATER_ROUTE_PREFIX,
    protectUpdaterRoutes,
    requireAdminSession
};
