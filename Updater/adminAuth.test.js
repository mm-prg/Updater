"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    UPDATER_ROUTE_PREFIX,
    protectUpdaterRoutes,
    requireAdminSession
} = require("./adminAuth");

function createResponse() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        }
    };
}

test("allows an authenticated administrator", () => {
    const response = createResponse();
    let nextCalled = false;

    requireAdminSession(
        { session: { isAdminAuthenticated: true } },
        response,
        () => { nextCalled = true; }
    );

    assert.equal(nextCalled, true);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, null);
});

test("rejects a request without a session", () => {
    const response = createResponse();
    let nextCalled = false;

    requireAdminSession({}, response, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.body, {
        ok: false,
        error: "Administrator authentication required."
    });
});

test("rejects a non-administrator session", () => {
    const response = createResponse();
    let nextCalled = false;

    requireAdminSession(
        { session: { isAdminAuthenticated: false } },
        response,
        () => { nextCalled = true; }
    );

    assert.equal(nextCalled, false);
    assert.equal(response.statusCode, 403);
});

test("mounts the authorization middleware on every Updater route", () => {
    const registrations = [];
    const router = {
        use(path, middleware) {
            registrations.push({ path, middleware });
        }
    };

    protectUpdaterRoutes(router);

    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].path, UPDATER_ROUTE_PREFIX);
    assert.equal(registrations[0].middleware, requireAdminSession);
});

test("refuses to mount without an Express-compatible router", () => {
    assert.throws(() => protectUpdaterRoutes(null), /Express router/);
    assert.throws(() => protectUpdaterRoutes({}), /Express router/);
});

test("registers authorization before every Updater endpoint", () => {
    const source = fs.readFileSync(path.join(__dirname, "pluginUpdater_server.js"), "utf8");
    const protectionIndex = source.indexOf("protectUpdaterRoutes(endpointsRouter)");
    const routePattern = /endpointsRouter\.(?:get|post|put|patch|delete)\(['"]\/plugins\/Updater/g;
    const routeIndexes = [...source.matchAll(routePattern)].map(match => match.index);

    assert.notEqual(protectionIndex, -1);
    assert.ok(routeIndexes.length > 0);
    assert.ok(routeIndexes.every(index => index > protectionIndex));
});
