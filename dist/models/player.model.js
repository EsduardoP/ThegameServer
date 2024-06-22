"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const playerSchema = new mongoose_1.default.Schema({
    name: { type: String, required: true, trim: true, unique: true },
    passwd: { type: String, required: true, trim: true, uniqued: true },
    score: { type: Number, default: 0 },
    lives: { type: Number, default: 3 },
    level: { type: Number, default: 0 }
});
const schemas = {
    Player: mongoose_1.default.model('Player', playerSchema),
};
exports.default = schemas;
