import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {areaOf, axonSvg, edgeDistance, planMetrics, planSvg, validatePlan} from '../shared/space-planning.js';
import {applyStudioActions, captureDraft, DraftHistory, prepareStudio} from '../shared/studio-actions.js';
import {createStudioServer} from '../server/index.mjs';
import {createSeed} from '../src/data.js';
import {reportHtml} from '../src/reports.js';
import {validateOutput} from '../worker/ai-contract.js';
import {endpointAtLength,snapPlanPoint} from '../shared/plan-geometry.js';

const vertices = [[2,3],[10,3],[10,6],[6,6],[6,9],[2,9]];
const legacy = {id:'outline', programId:'reading', label:'阅览', x:2, y:3, width:8, depth:6, height:3};
const outline = {id:'outline', programId:'reading', label:'阅览', height:3, geometry:{kind:'polygon', vertices}};
const inset = {id:'inset', programId:'meeting', x:7, y:7, width:2, depth:1, height:3};
const program = [{id:'reading', name:'阅读', count:1, area:36}, {id:'meeting', name:'交流', count:1, area:2}];
const planWith = (...spaces) => ({width:20, depth:15, spaces});

test('Precise edges preserve geometry representation and reject stale or invalid edits', () => {
  const p = prepareStudio({id:'precision',name:'精确绘图'});
  p.workflow.program = program;
  const option = p.workflow.options[0];
  option.plan = planWith(outline,{...legacy,id:'rectangle'});
  const edit = (targetId,edgeIndex,meters,expectedFootprint=vertices) =>
    applyStudioActions(p,[{type:'set_edge_length',targetId,edgeIndex,meters,expectedFootprint}]).project.workflow.options[0].plan;
  assert.deepEqual(endpointAtLength([2,3],[3,4],3.75),[4.25,6]);
  assert.deepEqual(edit('outline',2,3.75).spaces[0].geometry.vertices[3],[6.25,6]);
  assert.deepEqual(edit('outline',5,5).spaces[0].geometry.vertices[0],[2,4]);
  assert.equal(edit('rectangle',2,3.75,[[2,3],[10,3],[10,9],[2,9]]).spaces[1].width,3.75);
  assert.throws(()=>edit('outline',2,4,vertices.slice(1)),/轮廓已变化/);
  assert.throws(()=>edit('outline',2,8.5),/不能交叉/);
  assert.deepEqual(option.plan.spaces[0].geometry.vertices,vertices);
});

test('Snapping prioritizes endpoints then midpoints and orthogonal alignment, with a precision bypass', () => {
  const outlines=[{points:vertices,closed:true}];
  const snap=(point,options={})=>snapPlanPoint(point,{outlines,radius:.25,previous:[2,3],...options});
  assert.deepEqual(snap([2.2,3]),{point:[2,3],kind:'端点'});
  assert.deepEqual(snap([6.1,3.15]),{point:[6,3],kind:'中点'});
  assert.deepEqual(snap([7.12,3.09]),{point:[7.12,3],kind:'正交'});
  assert.deepEqual(snap([7.123,3.09],{enabled:false}),{point:[7.12,3.09],kind:''});
  assert.deepEqual(snap([2.2,3],{radius:.1}),{point:[2.2,3],kind:'正交'});
});

test('Legacy rectangles and concave polygons retain identity and derive true area', () => {
  assert.deepEqual(validatePlan(planWith(legacy), program).spaces[0], legacy);
  assert.deepEqual(validatePlan(planWith(outline), program).spaces[0], outline);
  assert.equal(areaOf(legacy), 48);
  assert.equal(areaOf(outline), 36);
  assert.equal(areaOf({...outline, geometry:{kind:'polygon', vertices:[...vertices].reverse()}}), 36);
  assert.equal(planMetrics(planWith(outline, inset), program).area, 38);
  assert.deepEqual(planMetrics(planWith(outline, inset), program).requirements.map(row => row.actualArea), [36, 2]);
});

test('The concave gap, touching edges, containment and crossings use true boundaries', () => {
  for (const [x, distance, overlaps] of [[7,1,0],[6,0,0],[5.5,0,1],[3,0,1]]) {
    const space = {...inset, x};
    assert.equal(edgeDistance(outline, space), distance);
    assert.equal(planMetrics(planWith(outline, space), program).overlaps.length, overlaps);
  }
  assert.equal(planMetrics(planWith(outline, {...outline, id:'same'}), program).overlaps.length, 1);
  const crossing = {...outline, id:'crossing', geometry:{kind:'polygon', vertices:[[0,4],[12,4],[12,5],[0,5]]}};
  assert.equal(planMetrics(planWith(outline, crossing), program).overlaps.length, 1);
  const rules = [{fromId:'reading', toId:'meeting', kind:'相邻', distance:1}];
  assert.equal(planMetrics(planWith(outline, inset), program, rules).rules[0].actualDistance, 1);
  const smallerCanvas = {...planWith(outline), width:9};
  assert.deepEqual(planMetrics(smallerCanvas, program).outside, ['outline']);
  assert.throws(() => validatePlan(smallerCanvas, program, {bounded:true}));
});

test('Malformed, self-intersecting and ambiguous polygons are rejected', () => {
  const invalid = [
    [[2,3],[10,9],[2,9],[10,3]],
    [[2,3],[10,3],[10,3],[2,9]],
    [[2,3],[6,3],[4,3],[6,9],[2,9]],
    [[2,3],[6,3],[10,3]],
    [[2,3],[10,3],[Infinity,9]],
    [[2,3],[2.001,3],[10,3],[2,9]],
    [[-1,3],[10,3],[2,9]],
    [[2,3],[10,3],[2,9,1]],
    Array.from({length:65}, (_, i) => [i+1, i+1])
  ];
  for (const points of invalid) {
    assert.throws(() => validatePlan(planWith({...outline, geometry:{kind:'polygon', vertices:points}}), program));
  }
  assert.throws(() => validatePlan(planWith({...outline, ...legacy}), program));
  assert.throws(() => validatePlan(planWith({...outline, programId:'foreign'}), program));
});

test('Plan and axon drawings render a concave outline and real area', () => {
  const plan = planWith(outline, inset);
  assert.match(planSvg(plan, program), /<polygon points="0,0 8,0 8,3 4,3 4,6 0,6"/);
  assert.match(planSvg(plan, program), /36 m²/);
  assert.match(axonSvg(plan, program), /<polygon points="391,66\.5 463,102\.5 436,116 400,98 373,111\.5 337,93\.5"/);
});

test('Polygon drawing, editing, undo and option copies share the draft actions', () => {
  const project = prepareStudio({id:'project', name:'项目'});
  project.workflow.program = structuredClone(program);
  const drawn = applyStudioActions(project, [{type:'add_polygon', name:'阅读', vertices}]).project;
  const original = drawn.workflow.options[0];
  const id = original.plan.spaces[0].id;
  const action = {type:'move_vertex', targetId:id, vertexIndex:2, point:[10,7]};
  const edited = applyStudioActions(drawn, [action]).project;
  const history = new DraftHistory();
  history.record(captureDraft(drawn), captureDraft(edited));
  assert.deepEqual(captureDraft(history.step(edited).project), captureDraft(drawn));
  assert.throws(() => applyStudioActions(drawn, [{...action, point:[2,3]}]));
  assert.throws(() => applyStudioActions(drawn, [{type:'update_space', targetId:id, area:50}]));
  const copy = applyStudioActions(drawn, [{type:'duplicate_option'}]);
  const duplicateId = copy.project.workflow.options[1].plan.spaces[0].id;
  assert.notEqual(duplicateId, id);
  const changedCopy = applyStudioActions(copy.project, [{...action, targetId:duplicateId}], {optionId:copy.optionId}).project;
  assert.deepEqual(changedCopy.workflow.options[0].plan, original.plan);
  assert.notDeepEqual(changedCopy.workflow.options[1].plan.spaces[0].geometry, original.plan.spaces[0].geometry);
});

test('Validated assistant edits preserve manually drawn geometry', () => {
  const project = prepareStudio({id:'project',name:'项目'});
  project.workflow.program = program;
  const option = project.workflow.options[0];
  option.plan = planWith(outline,inset);
  const assistantSelection = {optionId:option.id,spaceIds:[outline.id]};
  const output = actions => validateOutput({actions,message:'建议调整空间。',questions:[]},'assistant',[],
    {studioProject:project,assistantSelection});
  const {actions} = output([{type:'update_space',targetId:outline.id,name:'共享阅览',height:4}]);
  const updated = applyStudioActions(project,actions,assistantSelection).project.workflow.options[0].plan.spaces[0];
  assert.equal(updated.label,'共享阅览');
  assert.equal(updated.height,4);
  assert.deepEqual(updated.geometry,outline.geometry);
  assert.throws(() => output([{type:'update_space',targetId:outline.id,scale:2}]));
  assert.throws(() => output([{type:'move_vertex',targetId:outline.id}]));
  assert.throws(() => validateOutput({spaces:[outline]},'layout',[],{layoutProgram:program,layoutCanvas:planWith()}),
    /只支持矩形/);
});

test('Open ink is independent of floor area, supports undo and can explicitly become a space', () => {
  const project=prepareStudio({id:'sketch',name:'手绘'});
  const draw=(p,points)=>applyStudioActions(p,[{type:'draw_stroke',points}]).project;
  const plan=p=>p.workflow.options[0].plan;
  const open=draw(project,[[1,1],[2,4],[3,1],[4,4]]);
  assert.equal(planMetrics(plan(open)).area,0);
  const drawn=draw(open,[...vertices,vertices[0]]);
  const convert=p=>applyStudioActions(p,[{type:'stroke_to_space',targetId:plan(p).strokes.at(-1).id}]).project;
  const converted=convert(drawn);
  assert.deepEqual(plan(converted).strokes,plan(open).strokes);
  assert.equal(planMetrics(plan(converted)).area,36);
  const history=new DraftHistory();
  history.record(captureDraft(drawn),captureDraft(converted));
  assert.deepEqual(captureDraft(history.step(converted).project),captureDraft(drawn));
  const invalid=draw(open,[[0,0],[4,4],[0,4],[4,0],[0,0]]);
  assert.throws(()=>convert(invalid));
  assert.equal(plan(invalid).strokes.length,2);
  assert.throws(()=>draw(open,[[NaN,0],[2,3]]));
  assert.throws(()=>draw(open,Array(513).fill([1,1])));
  const copy=applyStudioActions(drawn,[{type:'duplicate_option'}]).project.workflow.options[1].plan;
  assert.notEqual(copy.strokes[0].id,plan(open).strokes[0].id);
  assert.deepEqual(copy.strokes[0].points,plan(open).strokes[0].points);
});

test('Any stroke can move, delete or become a space while retaining the other strokes', () => {
  const project=prepareStudio({id:'sketch',name:'多笔手绘'});
  const action=(p,a)=>applyStudioActions(p,[a]).project;
  const plan=p=>p.workflow.options[0].plan;
  const drawn=action(action(project,{type:'draw_stroke',points:[...vertices,vertices[0]]}),
    {type:'draw_stroke',points:[[1,12],[4,12],[3,11],[4,12],[3,13]]});
  const [boundary,arrow]=plan(drawn).strokes;
  const moved=action(drawn,{type:'move_stroke',targetId:arrow.id,dx:1,dy:1});
  assert.deepEqual(plan(moved).strokes[0],boundary);
  assert.deepEqual(plan(moved).strokes[1].points,arrow.points.map(([x,y])=>[x+1,y+1]));
  assert.throws(()=>action(drawn,{type:'move_stroke',targetId:arrow.id,dx:-2,dy:0}));
  assert.throws(()=>action(drawn,{type:'move_stroke',targetId:'foreign',dx:0,dy:0}));
  assert.throws(()=>action(drawn,{type:'move_stroke',targetId:arrow.id,dx:NaN,dy:0}));
  assert.deepEqual(plan(drawn).strokes,[boundary,arrow]);
  const converted=action(moved,{type:'stroke_to_space',targetId:boundary.id});
  assert.equal(planMetrics(plan(converted)).area,36);
  assert.deepEqual(plan(converted).strokes,[plan(moved).strokes[1]]);
  const history=new DraftHistory();
  const deleted=action(converted,{type:'delete_stroke',targetId:arrow.id});
  history.record(captureDraft(converted),captureDraft(deleted));
  assert.equal(plan(deleted).strokes,undefined);
  assert.deepEqual(captureDraft(history.step(deleted).project),captureDraft(converted));
  const display=planSvg(plan(drawn),[],{interactive:true,selectedStroke:boundary.id});
  assert.match(display,/data-stroke-id=/);
  assert.match(display,/aria-pressed="true"/);
  assert.doesNotMatch(planSvg(plan(drawn)),/data-stroke-id=|stroke-hit/);
});

test('State writes preserve polygons, block stale pages and protect fixed versions', async t => {
  const dir = await mkdtemp(join(tmpdir(),'polygon-plans-'));
  const origin = 'https://studio.test', token = 'polygon-bootstrap-'.repeat(3);
  let server = await createStudioServer({dataDir:dir, origin, bootstrapToken:token});
  t.after(async () => { await server.close(); await rm(dir,{recursive:true,force:true}); });
  let cookie = '';
  async function request(path, method='GET', data, headers={}) {
    return server.handle(new Request(origin+path,{method,headers:{Origin:origin,cookie,...headers},
      body:data===undefined?undefined:JSON.stringify(data)}));
  }
  async function ok(...args) {
    const response = await request(...args);
    const body = await response.json();
    assert.ok(response.ok,JSON.stringify(body));
    return body;
  }
  const modern = {'X-Plan-Geometry':'2'};
  const login = await request('/api/auth/setup','POST',{token,email:'owner@example.test',name:'学生',password:'test-password-123'});
  cookie = login.headers.get('set-cookie').split(';')[0];
  const state = createSeed();
  const p = prepareStudio(state.projects[0]);
  state.projects[0] = p;
  p.workflow.program = program.map(row => ({...row,users:'',relation:'',origin:'brief'}));
  p.workflow.options[0].plan = planWith(legacy,inset);
  const first = await ok('/api/state','PUT',state,{'If-None-Match':'*'});
  const snapshot = (label,etag) => ok('/api/snapshots','POST',{projectId:p.id,kind:'stage',label,note:'课堂检查'},{'If-Match':etag});
  const original = await snapshot('旧矩形',first.etag);
  const current = original.state;
  current.projects[0].workflow.options[0].plan = planWith(outline,inset);
  const saved = await ok('/api/state','PUT',current,{...modern,'If-Match':original.etag});
  const fixed = await snapshot('L 形',saved.etag);
  const locked = fixed.state.projects[0].versions;
  assert.match(reportHtml(locked[0]),/推演面积 50 m²/);
  assert.match(reportHtml(locked[1]),/推演面积 38 m²/);
  assert.match(reportHtml(locked[1]),/<polygon points="0,0 8,0 8,3 4,3 4,6 0,6"/);

  const downgraded = structuredClone(fixed.state);
  downgraded.projects[0].workflow.options[0].plan.spaces[0] = legacy;
  const oldPage = await request('/api/state','PUT',downgraded,{'If-Match':fixed.etag});
  assert.equal(oldPage.status,409);
  assert.equal((await oldPage.json()).code,'geometry_version');

  const invalid = structuredClone(fixed.state);
  invalid.projects[0].description = '此字段也不能部分更新';
  invalid.projects[0].workflow.options[0].plan.spaces[0].geometry.vertices[0] = [10,3];
  assert.equal((await request('/api/state','PUT',invalid,{...modern,'If-Match':fixed.etag})).status,400);
  assert.deepEqual((await ok('/api/state')).state,fixed.state);

  const updates = [3.5,4].map(height => {
    const draft = structuredClone(fixed.state);
    draft.projects[0].workflow.options[0].plan.spaces[1].height = height;
    return request('/api/state','PUT',draft,{...modern,'If-Match':fixed.etag});
  });
  const responses = await Promise.all(updates);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  assert.equal((await responses.find(r=>r.status===409).json()).code,'state_conflict');
  const latest = await ok('/api/state');
  const active = latest.state.projects[0];
  assert.deepEqual(active.workflow.options[0].plan.spaces[0],outline);
  assert.equal(active.workflow.options[0].plan.spaces[1].height,responses[0].ok?3.5:4);
  assert.deepEqual(active.versions,locked);
  await server.close();
  server = await createStudioServer({dataDir:dir, origin, bootstrapToken:token});
  assert.deepEqual((await ok('/api/state')).state,latest.state);
  const onlyInk=structuredClone(latest.state);
  const inkPlan=onlyInk.projects[0].workflow.options[0].plan;
  inkPlan.spaces=[];
  inkPlan.strokes=[{id:'stroke',points:[[2,3],[4,5],[8,3]]}];
  const sketchHeader={'X-Plan-Geometry':'3','If-Match':latest.etag};
  const inkSave=await ok('/api/state','PUT',onlyInk,sketchHeader);
  const stalePage=structuredClone(onlyInk);
  delete stalePage.projects[0].workflow.options[0].plan.strokes;
  assert.equal((await request('/api/state','PUT',stalePage,{...modern,'If-Match':inkSave.etag})).status,409);
  const inkSnapshot=await snapshot('手绘构思',inkSave.etag);
  const inkVersion=inkSnapshot.state.projects[0].versions.at(-1);
  assert.deepEqual(inkVersion.snapshot.workflow.options[0].plan.strokes,inkPlan.strokes);
  assert.match(reportHtml(inkVersion),/points="2,3 4,5 8,3"/);
});
