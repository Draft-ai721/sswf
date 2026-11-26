export function mountAccountMentors(user,request,message){
  const section=document.querySelector('#mentor-settings');
  const list=section.querySelector('[data-mentor-list]');
  const connect=section.querySelector('#connect-mentor-form');
  const makeCode=section.querySelector('[data-make-mentor-code]');
  const preview=section.querySelector('[data-mentor-code-result]');
  const input=preview.querySelector('input');
  section.hidden=false;
  makeCode.disabled=!user.identityConfirmed;
  section.querySelector('[data-mentor-identity]').hidden=user.identityConfirmed;

  const render=mentors=>{
    list.replaceChildren();
    if(!mentors.length){list.textContent='还没有关联导师。';return}
    for(const mentor of mentors){
      const row=document.createElement('div'),name=document.createElement('strong'),remove=document.createElement('button');
      row.className='mentor-list-row';name.textContent=mentor.name;
      remove.type='button';remove.className='btn text';remove.textContent='移除';
      remove.setAttribute('aria-label','移除导师 '+mentor.name);
      remove.addEventListener('click',async()=>{
        remove.disabled=true;
        try{render((await request('/api/mentors/'+encodeURIComponent(mentor.id),{},'DELETE')).mentors)}
        catch(error){message(error.message);remove.disabled=false}
      });
      row.append(name,remove);list.append(row);
    }
  };
  request('/api/mentors').then(data=>render(data.mentors)).catch(error=>{list.textContent=error.message});
  connect.addEventListener('submit',async event=>{
    event.preventDefault();
    const submit=connect.querySelector('[type=submit]');
    submit.disabled=true;
    try{
      const {mentors}=await request('/api/mentors/connect',{code:connect.elements.code.value});
      render(mentors);connect.reset();message('导师已加入名单。');
    }catch(error){message(error.message)}
    finally{submit.disabled=false}
  });
  makeCode.addEventListener('click',async()=>{
    makeCode.disabled=true;
    try{
      const result=await request('/api/mentors/code',{});
      input.value=result.code;
      preview.querySelector('small').textContent='有效至 '+new Date(result.expiresAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'});
      preview.hidden=false;input.focus();input.select();
    }catch(error){message(error.message)}
    finally{makeCode.disabled=false}
  });
  preview.querySelector('button').addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(input.value);message('导师连接码已复制。')}
    catch{input.select();message('请复制已选中的连接码。')}
  });
}

export function mountMentorPicker(form,api){
  if(!form||form.dataset.mentorPicker)return;
  form.dataset.mentorPicker='ready';
  const picker=form.elements.mentorId,role=form.elements.role,perspective=form.elements.perspective,email=form.elements.email;
  if(!picker)return;
  const sync=()=>{
    const teacher=role.value==='reviewer'&&perspective.value==='教师';
    picker.disabled=!teacher||picker.options.length<2;
    if(picker.disabled)picker.value='';
    email.disabled=!!picker.value;
  };
  for(const field of [role,perspective,picker])field.addEventListener('change',sync);
  sync();
  api('/api/mentors').then(({mentors})=>{
    if(!form.isConnected)return;
    for(const mentor of mentors)picker.add(new Option(mentor.name,mentor.id));
    sync();
  }).catch(()=>{});
}
