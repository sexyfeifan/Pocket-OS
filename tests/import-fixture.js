'use strict';
// Fictional data only. No real project names, IDs, links, or credentials.
module.exports = function fixture(workItemId = 'sample_001') {
  return {
    schemaVersion: 1,
    source: { host:'project.feishu.cn', projectKey:'example_space', workItemType:'example_type',
      workItemId, templateId:'example_template', url:'https://project.feishu.cn/example/story/detail/' + workItemId,
      updatedAt:'2026-01-01T08:00:00+08:00', fetchedAt:'2026-01-01T09:00:00+08:00' },
    fields: { title:'示例视频项目', projectCode:'DEMO-001', formats:['横屏','竖屏'], advertising:'有广告',
      cooperationPlatforms:['抖音'], platforms:[], publishDate:null, outlineDocument:null, scriptDocument:null },
    fieldKeys: { title:'name', projectCode:'field_code', formats:'field_format', advertising:'field_ad',
      cooperationPlatforms:'field_partner', platforms:'field_platform', publishDate:'field_publish',
      outlineDocument:'field_outline_doc', scriptDocument:'field_script_doc' },
    nodes: [
      { key:'outline', sourceNodeId:'state_outline', sourceName:'大纲提交', ranges:[{ start:'2026-01-02',end:'2026-01-02' }], status:'finished', actualEnd:'2026-01-03T10:00:00+08:00' },
      { key:'script', sourceNodeId:'state_script', sourceName:'脚本提交', ranges:[{ start:'2026-01-04',end:'2026-01-04' }], status:'doing' },
      { key:'shoot', sourceNodeId:'state_shoot', sourceName:'拍摄执行', ranges:[{ start:'2026-01-06',end:'2026-01-07' },{ start:'2026-01-10',end:'2026-01-10' }], status:'not_started' },
      { key:'acopy', sourceNodeId:'state_aco', sourceName:'A-Copy', ranges:[{ start:'2026-01-15',end:'2026-01-15' }], status:'not_started' },
      { key:'bcopy', sourceNodeId:'state_bco', sourceName:'B-Copy', ranges:[{ start:'2026-01-17',end:'2026-01-17' }], status:'not_started' },
      { key:'publish', sourceNodeId:'state_publish', sourceName:'发布', ranges:[{ start:'2026-01-20',end:'2026-01-20' }], status:'not_started' }
    ]
  };
};
