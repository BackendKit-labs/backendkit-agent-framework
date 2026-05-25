"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CallbackTransport = void 0;
class CallbackTransport {
    onEvent;
    inputHandlers = [];
    constructor(onEvent) {
        this.onEvent = onEvent;
    }
    emit(event) {
        this.onEvent(event);
    }
    onInput(handler) {
        this.inputHandlers.push(handler);
        return () => {
            this.inputHandlers = this.inputHandlers.filter(h => h !== handler);
        };
    }
    send(input) {
        for (const h of this.inputHandlers)
            h(input);
    }
    close() {
        this.inputHandlers = [];
    }
}
exports.CallbackTransport = CallbackTransport;
//# sourceMappingURL=CallbackTransport.js.map