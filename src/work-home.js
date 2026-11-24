import {esc} from './materials.js';
import {icon} from './data.js';

export function mainNavigation(route, guest) {
  const final = ['finals','final-new','final'].includes(route);
  const links = [['home','首页'],['projects','概念生成'],['finals','最终评审']];
  const current = route === 'home' ? 'home' : final ? 'finals' : 'projects';
  return `<header class="work-nav"><a class="work-brand" href="#/home"><img src="/assets/favicon.svg" alt="">共创</a>
    <nav aria-label="主要导航">${links.map(([id,label]) => `<a href="#/${id}" ${current===id?'aria-current="page"':''}>${label}</a>`).join('')}</nav>
    <a class="work-account" href="${guest?'/login':'/account'}">${guest?'登录':'账号'}</a></header>`;
}
function projectRows(projects) {
  return projects.map(p => `<a class="work-row" href="#/studio/${esc(p.id)}"><span class="work-thumb">${icon('cube')}</span>
    <strong>${esc(p.name)}</strong><small>${p.demo?'教学示例':new Date(p.updatedAt).toLocaleDateString('zh-CN')}</small>${icon('arrow')}</a>`).join('');
}
export function conceptList(projects) {
  const own=projects.filter(p=>!p.demo), demos=projects.filter(p=>p.demo);
  return `<section class="work-page"><div class="work-heading"><h1>概念生成</h1><button class="btn primary" data-action="new-project">＋ 新建草稿</button></div>
    <div class="work-section"><header><h2>我的草稿</h2><a href="#/collaboration">概念讨论 →</a></header>
    ${projectRows(own)||'<p class="work-empty">还没有草稿。新建后可以直接开始画。</p>'}</div>
    ${demos.length?`<details class="work-section"><summary>教学示例（${demos.length}）</summary>${projectRows(demos)}</details>`:''}</section>`;
}
export function homePage(projects) {
  const recent=projects.filter(p=>!p.demo).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,4);
  return `<section class="work-page work-home"><h1>设计工作台</h1><div class="work-portals">
    <article><div class="portal-art"><img src="/assets/architecture-0.svg" alt=""></div><div><h2>概念生成</h2><p>画平面、推敲体块，邀请师生讨论草稿。</p><button class="btn primary" data-action="new-project">开始画草稿 ${icon('arrow')}</button><a href="#/projects">我的草稿</a></div></article>
    <article><div class="portal-art final-art"><img src="/assets/architecture-2.svg" alt=""></div><div><h2>最终评审</h2><p>上传成熟作品，获取 AI 点评和教师审查。</p><a class="btn primary" href="#/final-new">提交作品 ${icon('arrow')}</a><a href="#/finals">我的评审</a></div></article>
    </div>${recent.length?`<section class="work-section"><header><h2>最近的草稿</h2><a href="#/projects">查看全部 →</a></header>${projectRows(recent)}</section>`:''}</section>`;
}
