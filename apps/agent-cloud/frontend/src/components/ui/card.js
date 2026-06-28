"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Card = Card;
const react_1 = __importDefault(require("react"));
function Card({ children, className = '', title, description }) {
    return (<div className={`bg-white rounded-xl shadow-sm border border-gray-200 p-6 ${className}`}>
      {title && (<div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
        </div>)}
      {children}
    </div>);
}
//# sourceMappingURL=card.js.map