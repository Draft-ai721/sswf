import {esc} from './materials.js';
import {icon} from './data.js';
import {workActions} from './work-actions.js';

export function mainNavigation(route, guest) {
  const final = ['finals','final-new','final'].includes(route);
  const links = [['home','首页'],['projects','概念生成'],['finals','作品评阅']];
  const current = route === 'home' ? 'home' : final ? 'finals' : 'projects';
  return `<header class="work-nav"><a class="work-brand" href="#/home"><img src="/assets/favicon.svg" alt="">共创</a>
    <nav aria-label="主要导航">${links.map(([id,label]) => `<a href="#/${id}" ${current===id?'aria-current="page"':''}>${label}</a>`).join('')}</nav>
    <a class="work-account" href="${guest?'/login':'/account'}">${guest?'登录':'账号'}</a></header>`;
}
function projectRows(projects, quick=false) {
  return projects.map(p=>{
    const content=`<span class="work-thumb">${icon('cube')}</span><strong>${esc(p.name)}</strong>
      <small>${p.demo?'教学示例':new Date(p.trashedAt||p.updatedAt).toLocaleDateString('zh-CN')}</small>${p.trashedAt?'':icon('arrow')}`;
    const row=p.trashedAt?`<div class="work-row">${content}</div>`:`<a class="work-row" href="#/studio/${esc(p.id)}">${content}</a>`;
    return quick?`<article class="work-list-item">${row}${workActions(p.id,p.trashedAt?
      [['draft-restore','恢复草稿']]:[['draft-snapshot','保存版本'],['draft-trash','移到回收站']])}</article>`:row;
  }).join('');
}
export function conceptList(projects,tab) {
  const trash=tab==='trash';
  const own=projects.filter(p=>!p.demo&&Boolean(p.trashedAt)===trash),demos=projects.filter(p=>p.demo);
  return `<section class="work-page"><div class="work-heading"><h1>概念生成</h1><button class="btn primary" data-action="new-project">＋ 新建草稿</button></div>
    <nav class="work-tabs" aria-label="草稿范围"><a href="#/projects" ${trash?'':'aria-current="page"'}>我的草稿</a><a href="#/projects/trash" ${trash?'aria-current="page"':''}>回收站</a></nav>
    <div class="work-section">${trash?'':`<div class="work-list-links"><a href="#/collaboration">概念讨论 →</a></div>`}
    ${projectRows(own,true)||`<p class="work-empty">${trash?'回收站里没有草稿。':'还没有草稿。新建后可以直接开始画。'}</p>`}</div>
    ${!trash&&demos.length?`<details class="work-section"><summary>教学示例（${demos.length}）</summary>${projectRows(demos)}</details>`:''}</section>`;
}
export function homePage(projects) {
  const recent=projects.filter(p=>!p.demo&&!p.trashedAt).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,4);
  return `<section class="work-page work-home"><h1>设计工作台</h1><div class="work-portals">
    <article><div class="portal-art"><img src="/assets/architecture-0.svg" alt=""></div><div><h2>概念生成</h2><p>画平面、推敲体块，邀请师生讨论草稿。</p><button class="btn primary" data-action="new-project">开始画草稿 ${icon('arrow')}</button><a href="#/projects">我的草稿</a></div></article>
    <article><div class="portal-art final-art"><img src="/assets/architecture-2.svg" alt=""></div><div><h2>作品评阅</h2><p>直接上传已有作品，获取 AI 点评和教师审查。</p><a class="btn primary" href="#/final-new">上传作品 ${icon('arrow')}</a><a href="#/finals">我的评阅</a></div></article>
    </div>${recent.length?`<section class="work-section"><header><h2>最近的草稿</h2><a href="#/projects">查看全部 →</a></header>${projectRows(recent)}</section>`:''}</section>`;
}
