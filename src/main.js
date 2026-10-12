import { Game } from './Game.js';

const canvas = document.getElementById('game');
const game = new Game(canvas);
window.__game = game;
game.build().catch((e) => {
  console.error(e);
  const el = document.getElementById('loading-text');
  if (el) el.textContent = '초기화 실패: ' + (e && e.message ? e.message : e);
});
