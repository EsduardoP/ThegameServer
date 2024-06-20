import mongoose from 'mongoose';

const playerSchema = new mongoose.Schema({
    id: { type: String, required: true },
    name: { type: String, required: true, trim: true, unique: true },
    passwd: {type:String, required: true, trim:true, uniqued: true},
    score: { type: Number, default: 0 },
    lives: {type: Number, default: 3},
    level: {type: Number, default: 0}
});

const schemas = {
    Player: mongoose.model('Player', playerSchema),
}

export default schemas;
