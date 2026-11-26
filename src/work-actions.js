import {esc} from './materials.js';

export function workActions(id, actions) {
  return `<details class="work-actions"><summary>快捷操作</summary><div class="work-action-items">
    ${actions.map(([action,label])=>`<button type="button" class="btn text" data-action="${action}" data-id="${esc(id)}">${label}</button>`).join('')}
    </div></details>`;
}
