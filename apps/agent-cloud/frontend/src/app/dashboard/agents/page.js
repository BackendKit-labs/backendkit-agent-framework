"use strict";
'use client';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = AgentsPage;
const react_1 = __importDefault(require("react"));
const card_1 = require("@/components/ui/card");
function AgentsPage() {
    return (<div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Agentes</h1>
      </div>
      
      <card_1.Card>
        <p className="text-gray-500 text-center py-8">
          Gestión de agentes - Próximamente
        </p>
      </card_1.Card>
    </div>);
}
//# sourceMappingURL=page.js.map