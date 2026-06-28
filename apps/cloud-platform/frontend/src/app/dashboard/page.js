"use strict";
'use client';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = DashboardPage;
const react_1 = __importDefault(require("react"));
const card_1 = require("@/components/ui/card");
function DashboardPage() {
    return (<div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <card_1.Card title="Total de Agentes" description="Agentes registrados en el sistema">
          <p className="text-3xl font-bold text-primary-600">0</p>
        </card_1.Card>
        
        <card_1.Card title="Agentes Activos" description="Agentes en ejecución">
          <p className="text-3xl font-bold text-green-600">0</p>
        </card_1.Card>
        
        <card_1.Card title="Total de Proyectos" description="Proyectos creados">
          <p className="text-3xl font-bold text-blue-600">0</p>
        </card_1.Card>
      </div>
    </div>);
}
//# sourceMappingURL=page.js.map