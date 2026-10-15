import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRows, STEPS, OFFICIAL_APPS } from '../src/services/onboarding.js'

test('人员导入：认中英文表头，部门按路径拆，是否列宽松识别', () => {
  const rows = parseRows([
    ['姓名', '账号', '手机号', '部门', '职位', '部门负责人', '管理员'],
    ['张三', 'zhangsan', '+8613800000001', '研发部/前端组', '工程师', '是', ''],
    ['李四', '', '13800000002', '销售部 > 华东', '', '', 'Y'],
    ['', '', '', '', '', '', ''],
    ['', 'nobody', '', '', '', '', '']
  ])
  assert.equal(rows.length, 3, '全空行丢掉')
  assert.deepEqual(rows[0].dept, ['研发部', '前端组'])
  assert.equal(rows[0].mobile, '13800000001')
  assert.equal(rows[0].leader, true)
  assert.equal(rows[0].admin, false)
  assert.deepEqual(rows[1].dept, ['销售部', '华东'])
  assert.equal(rows[1].username, null)
  assert.equal(rows[1].admin, true)
  assert.equal(rows[2].error, '缺姓名')
  assert.equal(rows[2].line, 5, '行号按表格算（含表头）')

  const en = parseRows([['Name', 'Username', 'Email'], ['Ann', '1bad', 'a@x.com']])
  assert.match(en[0].error, /账号格式/)
  assert.equal(en[0].email, 'a@x.com')
})

test('人员导入：没有姓名列、只有表头都报错', () => {
  assert.throws(() => parseRows([['账号'], ['a']]), /姓名/)
  assert.throws(() => parseRows([['姓名']]), /至少/)
})

test('开通向导：步骤顺序固定，官方应用地址合法', () => {
  assert.equal(STEPS[0], 'account')
  assert.equal(STEPS.at(-1), 'finish')
  for (const a of OFFICIAL_APPS) {
    assert.match(a.code, /^[a-z][a-z0-9-]{1,30}$/)
    assert.match(a.git, /^https:\/\/\S+\.git$/)
  }
})
