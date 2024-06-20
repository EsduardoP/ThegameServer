"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateLevelData = void 0;
function generateLevelData(nivelUsuario) {
    let numberOfKeys;
    let score = 0;
    if (nivelUsuario >= 0) {
        numberOfKeys = 2 + nivelUsuario;
        score = 10 + 10 * nivelUsuario;
    }
    else {
        throw new Error('El nivel del usuario no puede ser negativo');
    }
    const keys = generateKeysForLevel(numberOfKeys);
    return { keys, score };
}
exports.generateLevelData = generateLevelData;
function generateKeysForLevel(numberOfKeys) {
    const letters = ["i", "9", "o", "0", "p", "+", "a", "z", "s", "x", "d", "c"];
    const keys = [];
    for (let i = 0; i < numberOfKeys; i++) {
        const randomIndex = Math.floor(Math.random() * letters.length);
        keys.push(letters[randomIndex]);
    }
    return keys;
}
