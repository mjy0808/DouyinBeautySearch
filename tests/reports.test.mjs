import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReport } from '../src/reports.mjs';
import config from '../config.json' with {type:'json'};

test('existing forty saved records become twenty daily videos without approval fields', () => {
  const candidates = Array.from({length:40}, (_,i) => ({
    id:String(7692412559458533049n+BigInt(i)),author:'作者',caption:'标题',published_at:'2026-10-07 10:00',
    likes:10000+i*1000,width:576,height:1024,duration_seconds:9,aspect_ratio:'9:16',
    thumbnail:`assets/${7692412559458533049n+BigInt(i)}-1.jpg`,verified_at:'2026-10-07T07:18:16Z',
    frame_images:['assets/extra.jpg'],review_status:'awaiting_visual_review',confidence:.99,camera_note:'旋转'
  }));
  const report=normalizeReport({date:'2026-10-07',generated_at:'2026-10-07T07:18:16Z',status:'pending',items:[],candidates},config);
  assert.equal(report.status,'complete');assert.equal(report.items.length,20);
  assert.equal(report.items[0].likes,49000);
  assert.equal(report.items[0].collected_at,'2026-10-07T07:18:16Z');
  assert.ok(report.items.every(i=>i.duration_seconds<=15&&i.height>i.width&&i.likes>=5000));
  assert.equal('candidates' in report,false);
  for(const item of report.items) for(const key of ['review_status','confidence','frame_images','camera_note','verified_at']) assert.equal(key in item,false);
  assert.deepEqual(normalizeReport(report,config),report);
});
