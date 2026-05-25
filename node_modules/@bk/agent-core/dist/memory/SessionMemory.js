"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionMemory = void 0;
class SessionMemory {
    store = new Map();
    get(key) {
        return this.store.get(key);
    }
    set(key, value) {
        this.store.set(key, value);
    }
    getAll() {
        return Object.fromEntries(this.store.entries());
    }
    clear() {
        this.store.clear();
    }
}
exports.SessionMemory = SessionMemory;
//# sourceMappingURL=SessionMemory.js.map