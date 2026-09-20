/* global appState, flushSave, _dirtyTopics, _settingsDirty, _topicConflicts, savingPromise,
          loadData, selectTopic, markUpdated, saveData, renderAll, showToast, PocketWorkflow */
var PocketImports = (() => {
  'use strict';
  const base = '/api/integrations/feishu';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const statuses = { pending:'待确认', applied:'已应用', dismissed:'已忽略' };
  const nodeStatuses = { not_started:'未开始', doing:'进行中', finished:'已完成', unknown:'未知' };
  let dialog, state = {}, generation = 0, busy = false;
  const $ = id => document.getElementById(id);
  function valueText(value) {
    if (value === null || value === undefined || value === '') return '未填写';
    if (Array.isArray(value)) return value.length ? (typeof value[0] === 'object' ? PocketWorkflow.rangeText(value) : value.join(' / ')) : '未填写';
    return String(value);
  }
  function safeLink(value) {
    try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? esc(u.href) : ''; } catch { return ''; }
  }
  function button(action, label, id = '', primary = false) {
    return '<button type="button" class="editor-button' + (primary ? ' import-primary' : '') + '" data-import-action="' + action + '" data-id="' + esc(id) + '">' + label + '</button>';
  }
  async function request(path, method = 'GET', body) {
    const current = generation;
    const res = await fetch(base + path, { method, headers: { 'Content-Type':'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    let data; try { data = await res.json(); } catch { throw new Error('无法读取服务器响应，请检查登录与网络连接'); }
    if (current !== generation) throw Object.assign(new Error('操作已取消'), { cancelled:true });
    if (!res.ok) throw new Error(data.error || '请求失败');
    return data;
  }
  function shell(title, html, actions = '') {
    dialog.innerHTML = '<div class="import-header"><div><small>飞书项目 · 人工确认导入</small><h2>' + esc(title) +
      '</h2></div>' + button('close', '关闭') + '</div><p id="import-error" role="alert" hidden></p>' +
      html + (actions ? '<div class="review-actions">' + actions + '</div>' : '');
    dialog.scrollTop = 0;
  }
  function error(message) { const el = $('import-error'); if (el) { el.hidden = false; el.textContent = message; el.scrollIntoView({ block:'nearest' }); } }
  async function settled() {
    for (let i = 0; i < 3; i++) {
      await flushSave();
      if (!_dirtyTopics.size && !_settingsDirty && !savingPromise) break;
    }
    if (_dirtyTopics.size || _settingsDirty || _topicConflicts.size || savingPromise) throw new Error('请先完成当前项目的保存并解决同步冲突，再导入');
  }
  function mount() {
    if (dialog) return;
    dialog = document.createElement('dialog'); dialog.id = 'feishu-import-dialog';
    dialog.className = 'workflow-review import-dialog';
    document.body.appendChild(dialog);
    dialog.addEventListener('close', () => { generation++; state = {}; dialog.innerHTML = ''; });
    dialog.addEventListener('submit', e => { e.preventDefault(); dispatch('search'); });
    dialog.addEventListener('change', e => {
      if (e.target.id === 'import-mode') {
        $('import-existing').hidden = e.target.value !== 'bind';
        $('import-new').hidden = e.target.value !== 'create';
      }
    });
    dialog.addEventListener('click', e => {
      const target = e.target.closest('[data-import-action]');
      if (!target || target.disabled) return;
      target.disabled = true;
      dispatch(target.dataset.importAction, target.dataset.id).finally(() => { if (target.isConnected) target.disabled = false; });
    });
  }
  async function open(topicId = '', draftId = '') {
    mount(); const current = ++generation;
    state = { targetId:topicId, filter:'pending', page:1, query:'' };
    shell('飞书导入', '<p class="workflow-help">正在检查保存状态与接入配置…</p>');
    if (!dialog.open) dialog.showModal();
    try {
      await settled(); const config = await request('/config');
      if (current !== generation || !dialog.open) return;
      state.config = config;
      if (!config.enabled) { disabled(); return; }
      if (draftId) await detail(draftId); else await list();
    } catch (e) { if (current === generation) error(e.message); }
  }
  function disabled() {
    shell('先保护管理入口', '<p>服务器尚未设置管理密码，Agent 导入已禁用。</p><p class="workflow-help">请在部署环境设置 <code>POCKET_OS_PASSWORD</code> 并重启服务，然后使用管理密码进入本页面。查看密码不能管理导入。</p><p class="workflow-help">不会替你修改服务器凭证，也不会向未受保护的服务开放写入。</p>');
  }
  async function list() {
    const current = generation, query = '?status=' + state.filter + '&page=' + state.page + '&q=' + encodeURIComponent(state.query);
    const data = await request('/imports' + query);
    if (current !== generation || !dialog.open) return;
    shell('从飞书选择项目', '<p class="workflow-help">这里只列出 Agent 已提交的候选项目，不是飞书全部项目。点击刷新获取新提交；选择后可绑定已有项目或新建。未确认前不改变任何排期。</p>' +
      '<div class="import-toolbar">' + button('settings', 'Agent 接入设置') + button('refresh', '刷新列表') + button('mapping', '映射管理') + '</div>' +
      (state.filter === 'pending' && data.items.length > 0 ? '<div class="import-batch-actions"><label><input type="checkbox" id="select-all" data-import-action="select-all"> 全选</label>' +
        button('batch-dismiss', '批量忽略选中', '', false) + '<span id="selected-count">已选 0 条</span></div>' : '') +
      '<form class="import-search"><label>记录状态<select id="import-filter">' + Object.entries(statuses).map(([k,v]) => '<option value="' + k + '"' + (state.filter === k ? ' selected' : '') + '>' + v + '</option>').join('') +
      '</select></label><label>搜索项目<input id="import-search" type="search" placeholder="项目名、项目号或飞书 ID" value="' + esc(state.query) + '"></label><button class="editor-button">搜索</button></form>' +
      '<p class="workflow-help">共 ' + data.total + ' 条 · 第 ' + data.page + ' 页</p><div class="import-candidates">' + data.items.map(item =>
        '<article>' + (state.filter === 'pending' ? '<label class="import-select"><input type="checkbox" data-draft-id="' + esc(item.id) + '" data-import-action="select-draft"></label>' : '') +
        '<div class="import-item-content"><strong>' + esc(item.title) + '</strong><p>' + esc(item.projectCode || '项目号未填写') + ' · 飞书 ID ' + esc(item.source.workItemId) +
        '</p><p class="workflow-help">来源读取：' + esc(new Date(item.source.fetchedAt).toLocaleString('zh-CN')) + ' · ' + statuses[item.status] + '</p>' +
        button('detail', item.status === 'pending' ? '选择并核对' : '查看记录', item.id) + '</div></article>').join('') +
      (!data.items.length ? '<p class="import-empty">暂无候选项目。先在接入设置中生成凭证，让 Agent 提交你指定的项目，再回来刷新。</p>' : '') + '</div>',
    (data.page > 1 ? button('prev', '上一页') : '') + (data.page < data.pages ? button('next', '下一页') : ''));
    // 绑定全选事件
    const selectAll = $('select-all');
    if (selectAll) {
      selectAll.addEventListener('change', () => {
        const checked = selectAll.checked;
        dialog.querySelectorAll('[data-draft-id]').forEach(cb => { cb.checked = checked; });
        updateSelectedCount();
      });
    }
    // 绑定单选事件
    dialog.querySelectorAll('[data-draft-id]').forEach(cb => {
      cb.addEventListener('change', updateSelectedCount);
    });
  }
  function updateSelectedCount() {
    const selected = dialog.querySelectorAll('[data-draft-id]:checked').length;
    const countEl = $('selected-count');
    if (countEl) countEl.textContent = '已选 ' + selected + ' 条';
    const batchBtn = dialog.querySelector('[data-import-action="batch-dismiss"]');
    if (batchBtn) batchBtn.disabled = selected === 0;
  }
  async function settings() {
    state.config = await request('/config');
    if (!state.config.enabled) return disabled();
    const token = state.config.token;
    shell('Agent 接入设置', '<p class="workflow-help">飞书只需读取权限。Pocket OS 使用独立 Bearer Token，只允许提交待确认导入，不允许读取项目全库、修改排期、删除项目或操作备份。</p>' +
      '<label class="editor-field">Pocket OS 地址<input readonly value="' + esc(location.origin) + '"></label>' +
      '<label class="editor-field">提交接口<input readonly value="' + esc(location.origin + '/api/agent/v1/imports') + '"></label>' +
      '<p>凭证：' + (token.active ? '已启用 · 尾号 ' + esc(token.suffix) : '尚未生成') + '</p>' +
      '<div class="import-toolbar">' + button('token', token.active ? '撤销旧凭证并生成新凭证' : '生成 Agent 凭证') +
      (token.active ? button('revoke-confirm', '撤销凭证') : '') + '</div><div id="import-token-result"></div>' +
      '<details class="import-instructions"><summary>给 Agent 的固定指令</summary><textarea id="import-agent-prompt" readonly rows="9">' + esc(agentPrompt()) +
      '</textarea>' + button('copy-prompt', '复制指令') + '</details><p class="workflow-help"><a href="' + base + '/schema" target="_blank" rel="noopener">查看 / 保存 OpenAPI 接口文档 ↗</a> · 凭证不要放在提示词、URL 或公开文档中。</p>',
    button('list', '返回候选项目'));
  }
  function agentPrompt() {
    return '请通过已授权的飞书 MCP 或 Meegle CLI，只读取我手动选择的项目。不要修改飞书。\n' +
      'Pocket OS 地址：' + location.origin + '\n通过 GET /api/agent/v1/schema（已配置的 Bearer 凭证）读取接口规范。\n' +
      '先列出项目名称、项目号与唯一 ID 等待我选择，再读取字段元数据和完整的节点分页。按工作流模板及稳定字段/节点 ID 映射，不能按名称猜测或漏页。\n' +
      '整理项目名称、项目号、横竖屏、广告项目（有广告/无广告/未填写）、合作渠道、发布平台，及大纲、脚本、拍摄、ACO、BCO、发布的计划日期。文档链接与日期分开；实际完成时间不作为计划日期。\n' +
      'GET /api/agent/v1/mappings 查询已确认模板映射；冲突项请询问。未填日期留空，不倒排、不合并不连续拍摄段。发布时间字段与发布节点都提交，冲突由我选择。\n' +
      'POST /api/agent/v1/imports 提交符合 schemaVersion=1 的候选数据，携带 Idempotency-Key；同一次请求重试必须使用同一个键和完全相同的内容，重新读取或修改内容时使用新键。\n' +
      '仅生成待确认草稿，返回 reviewPath 让我在 Pocket OS 手动绑定或新建、预览并确认。失败不要宣称成功。Token 只从密钥配置读取，不要输出。';
  }
  async function mapping() {
    const current = generation;
    shell('映射管理', '<p class="workflow-help">配置飞书字段 ID 与 Pocket OS 字段的对应关系。映射保存后，后续导入相同模板的项目会自动应用。</p>' +
      '<div class="import-mapping-form">' +
      '<label class="editor-field">飞书站点<select id="mapping-host"><option value="project.feishu.cn">project.feishu.cn</option><option value="meegle.com">meegle.com</option></select></label>' +
      '<label class="editor-field">空间 ID<input id="mapping-project-key" placeholder="projectKey" maxlength="100"></label>' +
      '<label class="editor-field">工作项类型<input id="mapping-work-item-type" placeholder="workItemType" maxlength="100"></label>' +
      '<label class="editor-field">模板 ID<input id="mapping-template-id" placeholder="templateId" maxlength="100"></label>' +
      '<div class="import-mapping-actions">' +
      '<button class="editor-button" data-import-action="load-mapping">加载当前映射</button>' +
      '<button class="editor-button" data-import-action="learn-mapping">从历史导入学习</button>' +
      '</div>' +
      '</div>' +
      '<div id="mapping-fields" class="import-mapping-fields"></div>',
      button('list', '返回列表') + button('save-mapping', '保存映射', '', true));
  }
  async function loadMapping() {
    const current = generation;
    const host = $('mapping-host').value;
    const projectKey = $('mapping-project-key').value.trim();
    const workItemType = $('mapping-work-item-type').value.trim();
    const templateId = $('mapping-template-id').value.trim();
    if (!projectKey || !workItemType || !templateId) {
      error('请填写空间 ID、工作项类型和模板 ID');
      return;
    }
    try {
      const data = await request('/mappings?host=' + encodeURIComponent(host) +
        '&projectKey=' + encodeURIComponent(projectKey) +
        '&workItemType=' + encodeURIComponent(workItemType) +
        '&templateId=' + encodeURIComponent(templateId));
      if (current !== generation || !dialog.open) return;
      const fields = [
        { key: 'field:title', label: '项目名称' },
        { key: 'field:projectCode', label: '项目号' },
        { key: 'field:formats', label: '横竖屏' },
        { key: 'field:advertising', label: '广告项目' },
        { key: 'field:cooperationPlatforms', label: '合作渠道' },
        { key: 'field:platforms', label: '发布平台' },
        { key: 'field:outlineDocument', label: '大纲文档' },
        { key: 'field:scriptDocument', label: '脚本文档' },
        { key: 'step:outline', label: '大纲节点' },
        { key: 'step:script', label: '脚本节点' },
        { key: 'step:shoot', label: '拍摄节点' },
        { key: 'step:acopy', label: 'ACO 节点' },
        { key: 'step:bcopy', label: 'BCO 节点' },
        { key: 'step:publish', label: '发布节点' }
      ];
      const html = fields.map(f => '<label class="editor-field">' + f.label + '<input data-mapping-key="' + f.key +
        '" placeholder="飞书字段/节点 ID" value="' + esc(data.mapping[f.key] || '') + '"></label>').join('');
      $('mapping-fields').innerHTML = html + (data.conflicts.length ?
        '<p class="import-warning">冲突字段：' + data.conflicts.join(', ') + '。请手动确认正确映射。</p>' : '');
      state.mappingData = { host, projectKey, workItemType, templateId };
    } catch (e) { if (current === generation) error(e.message); }
  }
  async function saveMapping() {
    if (!state.mappingData) { error('请先加载映射'); return; }
    const mapping = {};
    dialog.querySelectorAll('[data-mapping-key]').forEach(el => {
      const value = el.value.trim();
      if (value) mapping[el.dataset.mappingKey] = value;
    });
    try {
      await request('/mappings', 'POST', { ...state.mappingData, mapping });
      showToast('映射已保存', 'success');
      await list();
    } catch (e) { error(e.message); }
  }
  async function learnMapping() {
    const host = $('mapping-host').value;
    const projectKey = $('mapping-project-key').value.trim();
    const workItemType = $('mapping-work-item-type').value.trim();
    const templateId = $('mapping-template-id').value.trim();
    if (!projectKey || !workItemType || !templateId) {
      error('请填写空间 ID、工作项类型和模板 ID');
      return;
    }
    try {
      const result = await request('/mappings/learn', 'POST', { host, projectKey, workItemType, templateId });
      if (result.success) {
        showToast(result.message, 'success');
        // 重新加载映射
        await loadMapping();
      } else {
        showToast(result.message, 'warn');
      }
    } catch (e) { error(e.message); }
  }
  async function batchDismiss() {
    const selected = [...dialog.querySelectorAll('[data-draft-id]:checked')].map(cb => cb.dataset.draftId);
    if (selected.length === 0) { error('请先选择要忽略的记录'); return; }
    if (!confirm('确认忽略选中的 ' + selected.length + ' 条记录？')) return;
    try {
      const result = await request('/imports/batch-dismiss', 'POST', { draftIds: selected });
      const successCount = result.results.filter(r => r.success).length;
      const errorCount = result.results.filter(r => r.error).length;
      if (errorCount > 0) {
        showToast('已忽略 ' + successCount + ' 条，' + errorCount + ' 条失败', 'warn');
      } else {
        showToast('已忽略 ' + successCount + ' 条记录', 'success');
      }
      await list();
    } catch (e) { error(e.message); }
  }
  async function detail(id) {
    const current = generation, item = await request('/imports/' + id);
    if (current !== generation || !dialog.open) return;
    state.item = item; state.preview = null;
    const source = item.payload.source, link = safeLink(source.url), targetId = state.targetId || item.boundTopicId || '';
    const header = '<p>' + esc(item.title) + ' · ' + esc(item.projectCode || '项目号未填写') + '</p><p class="workflow-help">飞书 ID ' +
      esc(source.workItemId) + ' · 模板 ' + esc(source.templateId) + ' · 读取时间 ' + esc(new Date(source.fetchedAt).toLocaleString('zh-CN')) +
      (link ? ' · <a href="' + link + '" target="_blank" rel="noopener">打开飞书来源 ↗</a>' : '') + '</p>';
    if (item.status !== 'pending') {
      shell('导入记录 · ' + statuses[item.status], header + '<p>本条记录已处理。飞书内容更新后，请让 Agent 重新读取并提交新的候选数据。</p>',
        (item.result ? button('topic', '打开 Pocket OS 项目', item.result.topicId) : '') + button('list', '返回列表'));
      return;
    }
    shell('选择导入目标', header + '<label class="editor-field">导入方式<select id="import-mode"><option value="bind">绑定 / 更新已有项目</option><option value="create">创建新项目</option></select></label>' +
      '<label class="editor-field" id="import-existing">Pocket OS 项目<select id="import-topic"><option value="">请手动选择</option>' +
      appState.topics.map(t => '<option value="' + esc(t.id) + '"' + (targetId === t.id ? ' selected' : '') + '>' + esc(t.title + (t.projectCode ? ' · ' + t.projectCode : '') + (t.completed ? '（已归档）' : '')) + '</option>').join('') +
      '</select></label><label class="editor-field" id="import-new" hidden>新项目名称<input id="import-title" maxlength="200" value="' + esc(item.payload.fields.title || '') + '"></label>' +
      (item.boundTopicId ? '<p class="workflow-help">已找到这个飞书 ID 的现有绑定。仍需你核对后确认，不会自动更新。</p>' : '') +
      '<p class="workflow-help">下一步逐项选择字段和日期。全部不勾选时，仅建立 / 更新来源绑定，不改变项目内容。</p>',
      button('list', '返回列表') + button('dismiss-confirm', '忽略这条记录') + button('preview', '预览字段与日期', '', true));
  }
  async function showPreview() {
    const current = generation;
    await settled();
    if (current !== generation) return;
    const body = { mode:$('import-mode').value, topicId:$('import-topic').value, title:$('import-title').value.trim() };
    const p = await request('/imports/' + state.item.id + '/preview', 'POST', body);
    state.preview = p; state.mode = body.mode;
    const html = '<p class="workflow-help">只应用勾选项。已有值默认保留，空值不自动清空；未勾选的节点、备注、Canbox 绑定、完成和异常状态都不改变。</p>' +
      '<div class="import-differences">' + p.rows.map((r, i) => '<article class="import-difference' + (r.conflict || r.options ? ' import-conflict' : '') + '">' +
        '<label class="import-select"><input type="checkbox" data-import-row="' + i + '"' + (r.selected ? ' checked' : '') + (r.locked ? ' disabled' : '') + '><strong>' + esc(r.label) + '</strong></label>' +
        '<div class="import-values"><p><small>Pocket OS 当前</small>' + esc(valueText(r.current)) + '</p><p><small>飞书新值</small>' + esc(valueText(r.incoming)) +
        '</p>' + (r.previous !== null ? '<p><small>上次读取的飞书值</small>' + esc(valueText(r.previous)) + '</p>' : '') + '</div>' +
        (r.options ? '<label>两处发布日期不同，请选择<select data-import-choice="' + i + '"><option value="">请选择来源</option>' +
          r.options.map(o => '<option value="' + o.id + '">' + esc(o.label + '：' + valueText(o.value)) + '</option>').join('') + '</select></label>' : '') +
        '<p class="workflow-help">来源：' + esc((r.sourceName || '') + ' ' + r.sourceKey) +
        (r.sourceStatus ? ' · 飞书状态：' + esc(nodeStatuses[r.sourceStatus] || r.sourceStatus) + '（参考，不自动应用）' : '') + '</p>' +
        (r.clear ? '<p class="import-warning">勾选会清空当前值，需要下方额外确认。</p>' : '') +
        (r.bothChanged ? '<p class="import-warning">两边都已修改，请比较后再选择。</p>' : r.conflict ? '<p class="import-warning">与现有值不同，默认不覆盖。</p>' : '') +
        (r.mappingChanged ? '<p class="import-warning">来源模板或字段 / 节点 ID 与上次确认的映射不同。</p>' : '') +
        (r.locked ? '<p class="workflow-help">新项目使用你在上一步确认的名称；如需修改，请返回选择。</p>' : '') +
        (r.skipped ? '<p class="workflow-help">此节点为“不适用”；导入日期也不会自动恢复适用。</p>' : '') + '</article>').join('') + '</div>' +
      '<label class="import-check"><input type="checkbox" id="import-allow-clear">我确认允许所选空值清空对应的现有值</label>' +
      '<label class="import-check"><input type="checkbox" id="import-allow-mapping">我已核对所选字段 / 节点的来源映射变化</label>' +
      '<p class="workflow-help">预览十分钟内有效；项目发生修改时必须重新预览。新项目默认按日期推进，飞书状态仅作参考。</p>';
    shell('确认导入 · ' + (body.mode === 'create' ? '新建项目' : '绑定 / 更新'), html,
      button('detail', '返回选择', state.item.id) + button('apply', '确认应用所选并绑定', '', true));
  }
  async function refreshProject(topicId) {
    await loadData();
    dialog.close();
    if (appState.topics.some(t => t.id === topicId)) selectTopic(topicId);
    else showToast('服务器已保存，请刷新页面查看最新项目', 'warn');
  }
  async function projectAction(id, action) {
    const current = ++generation;
    mount(); if (!dialog.open) dialog.showModal();
    shell('正在准备预览', '<p>正在检查项目版本…</p>');
    await settled();
    if (current !== generation) return;
    const p = await request('/topics/' + id + '/preview-action', 'POST', { action });
    state.actionPreview = { ...p, topicId:id };
    shell(action === 'unlink' ? '解除飞书绑定' : '撤回上次导入', '<p>' + esc(p.title) + '</p><p>' + esc(p.message) + '</p>' +
      p.changes.map(c => '<p class="workflow-help">' + esc(c.label) + '：' + esc(valueText(c.after)) + ' → ' + esc(valueText(c.before)) + '</p>').join(''),
    button('close', '取消') + button('apply-action', '确认' + (action === 'unlink' ? '解除绑定' : '撤回导入'), '', true));
  }
  async function dispatch(action, id) {
    if (action === 'close') return dialog.close();
    if (busy) return;
    busy = true;
    const current = generation;
    try {
      if (action === 'list' || action === 'refresh') return await list();
      if (action === 'settings') return await settings();
      if (action === 'mapping') return await mapping();
      if (action === 'load-mapping') return await loadMapping();
      if (action === 'save-mapping') return await saveMapping();
      if (action === 'learn-mapping') return await learnMapping();
      if (action === 'batch-dismiss') return await batchDismiss();
      if (action === 'select-all') return; // 由事件监听器处理
      if (action === 'select-draft') return; // 由事件监听器处理
      if (action === 'detail') return await detail(id);
      if (action === 'search') { state.filter = $('import-filter').value; state.query = $('import-search').value.trim(); state.page = 1; return await list(); }
      if (action === 'prev' || action === 'next') { state.page += action === 'prev' ? -1 : 1; return await list(); }
      if (action === 'preview') return await showPreview();
      if (action === 'topic') { dialog.close(); selectTopic(id); return; }
      if (action === 'copy-prompt') { await navigator.clipboard.writeText($('import-agent-prompt').value); showToast('指令已复制', 'success'); return; }
      if (action === 'token') {
        const result = await request('/token', 'POST', {});
        await settings();
        $('import-token-result').innerHTML = '<p class="import-warning">凭证只显示这一次，关闭后无法找回。旧凭证已失效。</p><label class="editor-field">Agent Token<input id="import-new-token" type="password" readonly autocomplete="off" value="' + esc(result.token) + '"></label>' + button('copy-token', '复制凭证');
        return;
      }
      if (action === 'copy-token') { await navigator.clipboard.writeText($('import-new-token').value); showToast('凭证已复制，请存入 Agent 密钥配置', 'success'); return; }
      if (action === 'revoke-confirm') {
        shell('撤销 Agent 凭证', '<p>撤销后，该凭证立即失效。已有项目和待确认数据不会删除。</p>', button('settings', '取消') + button('revoke', '确认撤销')); return;
      }
      if (action === 'revoke') { await request('/token', 'DELETE'); return await settings(); }
      if (action === 'dismiss-confirm') {
        shell('忽略导入记录', '<p>只标记此条候选记录为已忽略，不会删除或修改项目。之后仍可查看记录。</p>', button('detail', '取消', state.item.id) + button('dismiss', '确认忽略')); return;
      }
      if (action === 'dismiss') { await request('/imports/' + state.item.id + '/dismiss', 'POST', {}); return await list(); }
      if (action === 'apply') {
        const p = state.preview, selected = [...dialog.querySelectorAll('[data-import-row]:checked')].map(el => p.rows[Number(el.dataset.importRow)].id);
        const choices = {};
        dialog.querySelectorAll('[data-import-choice]').forEach(el => { choices[p.rows[Number(el.dataset.importChoice)].id] = el.value; });
        const body = { previewId:p.previewId, selected, choices, allowClear:$('import-allow-clear').checked, allowMappingChange:$('import-allow-mapping').checked };
        await settled();
        if (current !== generation) return;
        const result = await request('/imports/' + state.item.id + '/apply', 'POST', body);
        await refreshProject(result.topicId); showToast('导入已保存，其他节点日期保持不变', 'success'); return;
      }
      if (action === 'apply-action') {
        await settled();
        if (current !== generation) return;
        const p = state.actionPreview;
        const result = await request('/topics/' + p.topicId + '/apply-action', 'POST', { previewId:p.previewId });
        await refreshProject(result.topicId); showToast('操作已保存', 'success');
      }
    } catch (e) { if (!e.cancelled && current === generation) error(e.message); }
    finally { busy = false; }
  }
  function businessHtml(t) {
    return '<details id="project-business" data-remember><summary>项目资料' + (t.projectCode ? ' · ' + esc(t.projectCode) : '') + '</summary><div class="import-business">' +
      '<label>项目号<input id="business-code" data-draft maxlength="100" value="' + esc(t.projectCode || '') + '" onchange="PocketImports.editField(\'' + t.id + '\',\'projectCode\',this.value)"></label>' +
      '<label>广告项目<select aria-label="广告项目" onchange="PocketImports.editField(\'' + t.id + '\',\'advertising\',this.value)">' +
      ['', '有广告', '无广告'].map(v => '<option value="' + v + '"' + ((t.advertising || '') === v ? ' selected' : '') + '>' + (v || '未填写') + '</option>').join('') + '</select></label>' +
      '<fieldset><legend>横竖屏（可多选）</legend>' + ['横屏', '竖屏'].map(v => '<label><input type="checkbox" ' + ((t.formats || []).includes(v) ? 'checked ' : '') +
        'onchange="PocketImports.editFormat(\'' + t.id + '\',\'' + v + '\',this.checked)">' + v + '</label>').join('') + '</fieldset>' +
      '<label>合作渠道<input id="business-partners" data-draft placeholder="多个渠道用逗号分隔" value="' + esc((Array.isArray(t.cooperationPlatforms) ? t.cooperationPlatforms : []).join('，')) + '" onchange="PocketImports.editField(\'' + t.id + '\',\'cooperationPlatforms\',this.value)"></label>' +
      ['outlineDocument', 'scriptDocument'].map((key, i) => '<label>' + (i ? '脚本' : '大纲') + '文档链接<input id="business-' + key + '" data-draft type="url" value="' + esc(t[key] || '') +
        '" onchange="PocketImports.editField(\'' + t.id + '\',\'' + key + '\',this.value)"></label>').join('') + '</div><p class="workflow-help">广告属性、合作渠道和发布平台分别记录；这些资料不改变排期。</p></details>';
  }
  function bindingHtml(t) {
    const binding = t.feishuBinding, history = [...(t.integrationHistory || [])].reverse();
    if (!binding && !history.length) return '';
    const url = safeLink(binding?.source?.url);
    return '<details id="project-feishu" data-remember><summary>' + (binding ? '已绑定飞书项目' : '飞书导入记录') + '</summary>' +
      (binding ? '<p>飞书 ID ' + esc(binding.source.workItemId) + (url ? ' · <a href="' + url + '" target="_blank" rel="noopener">打开来源 ↗</a>' : '') +
        '</p><p class="workflow-help">上次读取：' + esc(new Date(binding.source.fetchedAt).toLocaleString('zh-CN')) + ' · 这里只展示来源状态，不自动回写完成或延期。</p>' +
        '<div class="import-source-nodes">' + (binding.nodeStates || []).map(n => '<p>' + esc(n.sourceName) + ' · ' + esc(nodeStatuses[n.status] || n.status) +
          ' · 原计划 ' + esc(PocketWorkflow.rangeText(n.ranges)) + '</p>').join('') + '</div>' +
        '<div class="workflow-fields"><button class="editor-button" onclick="PocketImports.open(\'' + t.id + '\')">选择更新数据</button><button class="editor-button" onclick="PocketImports.action(\'' + t.id + '\',\'unlink\')">解除绑定</button></div>' : '') +
      '<h4>导入与绑定记录</h4>' + history.map(h => '<div class="history-entry"><p>' + esc(new Date(h.at).toLocaleString('zh-CN')) + ' · ' +
        ({ import:'确认导入', unlink:'解除绑定', undo:'撤回导入' }[h.kind] || esc(h.kind)) + '</p>' +
        (h.changes || []).map(c => '<p class="workflow-help">' + esc(c.label) + '：' + esc(valueText(c.before)) + ' → ' + esc(valueText(c.after)) + '</p>').join('') + '</div>').join('') +
      (history[0]?.kind === 'import' ? '<button class="editor-button" onclick="PocketImports.action(\'' + t.id + '\',\'undo\')">预览撤回上次导入</button><p class="workflow-help">仅当导入后未发生其他修改时支持整体撤回；否则请逐项恢复排期。</p>' : '') + '</details>';
  }
  function editField(id, key, value) {
    const t = appState.topics.find(t => t.id === id); if (!t) return;
    if (!['projectCode', 'advertising', 'cooperationPlatforms', 'outlineDocument', 'scriptDocument'].includes(key)) return;
    if (key.endsWith('Document') && value && !safeLink(value)) { showToast('文档链接必须是 HTTPS 地址，未保存', 'warn'); return; }
    const next = key === 'cooperationPlatforms' ? [...new Set(value.split(/[,，、]/).map(s => s.trim()).filter(Boolean))] : value.trim();
    if (key === 'cooperationPlatforms' && (next.length > 20 || next.some(v => v.length > 60))) {
      showToast('最多 20 个合作渠道，每个名称不超过 60 字，未保存', 'warn'); return;
    }
    t[key] = next;
    markUpdated(t); saveData();
  }
  function editFormat(id, value, checked) {
    const t = appState.topics.find(t => t.id === id); if (!t) return;
    t.formats = checked ? [...new Set([...(t.formats || []), value])] : (t.formats || []).filter(v => v !== value);
    markUpdated(t); saveData();
  }
  function start() {
    const id = new URLSearchParams(location.search).get('import');
    if (id && /^fi_[a-f0-9]{40}$/.test(id)) open('', id);
  }
  return { open, businessHtml, bindingHtml, editField, editFormat, start,
    action: (id, action) => projectAction(id, action).catch(e => { if (!e.cancelled) error(e.message); }) };
})();
