"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nowIso = nowIso;
exports.isoDaysAgo = isoDaysAgo;
function nowIso() {
    return new Date().toISOString();
}
function isoDaysAgo(days) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString();
}
