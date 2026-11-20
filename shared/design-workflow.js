export const DESIGN_STAGES=[
 {id:1,name:'任务与目标',en:'BRIEF',purpose:'理解不同主体的需求，提出值得设计的问题。',fields:[['buildingType','建筑类型'],['site','基地与场所'],['scale','规模与课程要求'],['stakeholders','使用者、管理者与其他主体'],['questions','核心设计问题'],['goals','设计目标与判断依据'],['unknowns','待确认事项']]},
 {id:2,name:'场地与使用者调研',en:'RESEARCH',purpose:'用观察、访谈和材料建立设计依据。'},
 {id:3,name:'功能与可行性核查',en:'PROGRAM',purpose:'核对功能、面积与约束，记录需要验证的条件。'},
 {id:4,name:'概念与多方案探索',en:'EXPLORE',purpose:'从共同依据出发，比较策略并解释选择。'},
 {id:5,name:'方案设计与表达',en:'DESIGN',purpose:'把策略落实为相互协调的图纸、模型与说明。',fields:[['intent','设计主张与对应问题'],['layout','布局、功能与流线'],['space','空间、尺度与环境体验'],['technical','结构、消防与无障碍的初步考虑'],['unresolved','待验证问题与下一步']]},
 {id:6,name:'评审、修改与确认',en:'DIALOGUE',purpose:'邀请多方讨论，用依据回应意见并复核修改。',fields:[['reflection','本轮设计反思'],['nextQuestions','未解决问题与下一轮计划']]}
];
export const STAGE_STATUS={idle:'未开始',working:'共创中',selfchecked:'学生已自查'};
export const SCORE_FIELDS=[['function','功能组织'],['flow','交通流线'],['site','场地响应'],['public','公共空间'],['feasibility','条件适配']];
export const DESIGN_PERSPECTIVES=['综合讨论','教师视角（AI 模拟）','同伴视角（AI 模拟）','使用者视角（AI 模拟）'];
export function emptyWorkflow(p={}){return {schema:1,active:1,stages:DESIGN_STAGES.map(s=>({id:s.id,status:'idle',notes:'',fileIds:[]})),brief:{buildingType:'',site:'',scale:'',stakeholders:p.users||'',questions:p.description||'',goals:p.goal||'',unknowns:''},findings:[],pins:[],mapFileId:'',program:[],site:{area:0,targetArea:0},constraints:[],options:[],selectedOptionId:'',choiceReason:'',design:{intent:'',layout:'',space:'',technical:'',unresolved:''},review:{reflection:'',nextQuestions:''},discussions:[],aiCandidates:[]}}
export function workflowOf(p){return p?.workflow||emptyWorkflow(p)}
export function areaSummary(w){const total=w.program.reduce((n,r)=>n+r.count*r.area,0);return {total:Math.round(total*100)/100,target:w.site.targetArea,difference:w.site.targetArea?Math.round((total-w.site.targetArea)*100)/100:null,siteArea:w.site.area}}
const stageBlock=(w,n)=>n===1?w.brief:n===2?{findings:w.findings,pins:w.pins,mapFileId:w.mapFileId}:n===3?{program:w.program,site:w.site,summary:areaSummary(w),constraints:w.constraints}:n===4?{options:w.options,selectedOptionId:w.selectedOptionId,choiceReason:w.choiceReason}:n===5?w.design:{...w.review,discussions:w.discussions};
export function workflowStageText(p,n){const w=workflowOf(p);return JSON.stringify({stage:DESIGN_STAGES[n-1].name,notes:w.stages[n-1].notes,materials:w.stages[n-1].fileIds,content:stageBlock(w,n)},null,2)}
export function workflowText(p){if(!p.workflow)return '';return DESIGN_STAGES.map(s=>s.id+' / '+s.name+' · '+STAGE_STATUS[p.workflow.stages[s.id-1].status]+'\n'+workflowStageText(p,s.id)).join('\n\n')+'\n\nAI候选与来源\n'+JSON.stringify(p.workflow.aiCandidates,null,2)}
export function workflowFingerprint(w){if(!w)return null;const {active,aiCandidates,...content}=w;return content}
export function stageChecklist(p,n){const w=workflowOf(p);const text=s=>!!String(s||'').trim();return n===1?[['核心问题',text(w.brief.questions)],['设计目标',text(w.brief.goals)],['相关主体',text(w.brief.stakeholders)]]:n===2?[['至少一条调研发现',w.findings.length>0],['每条发现有材料或来源',w.findings.length>0&&w.findings.every(f=>f.fileIds.length||text(f.source))]]:n===3?[['功能面积表',w.program.length>0],['约束核查记录',w.constraints.length>0],['待核查项已说明',w.constraints.every(c=>c.status!=='待核查'||text(c.explanation))]]:n===4?[['至少两个备选方案',w.options.length>=2],['选择了发展方案',!!w.selectedOptionId],['解释了选择理由',text(w.choiceReason)]]:n===5?[['设计说明',text(w.design.intent)],['已关联阶段图纸或模型',w.stages[4].fileIds.length>0],['记录待验证问题',text(w.design.unresolved)]]:[['保存过阶段版本',p.versions?.length>0],['本轮反思',text(w.review.reflection)],['下一轮计划',text(w.review.nextQuestions)]]}
