export interface Player {
  id: number;
  name: string;
  score: number;
  lives: number;
  level: number;
}

export interface ConnectedUser {
  id: string;
  name: string; 
}