export function generateLevelData(nivelUsuario: number):  { keys: string[], score: number } {
    let numberOfKeys: number;
    let score: number = 0;
    if (nivelUsuario >= 0) {
        numberOfKeys = 2 + nivelUsuario;
        score = 10 + 10 * nivelUsuario;
    } else {
        throw new Error('El nivel del usuario no puede ser negativo');
    }

    const keys = generateKeysForLevel(numberOfKeys);

    return { keys, score };
}

function generateKeysForLevel(numberOfKeys: number): string[] {
    const letters = ["i", "9", "o", "0", "p", "+", "a", "z", "s", "x", "d", "c"];
    const keys: string[] = [];
    for (let i = 0; i < numberOfKeys; i++) {
        const randomIndex = Math.floor(Math.random() * letters.length);
        keys.push(letters[randomIndex]);
    }
    return keys;
}

