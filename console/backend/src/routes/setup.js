// 首次初始化向导（公开接口，仅在没有用户时可用）
import express from 'express'
import { wrap } from '../lib/http.js'
import * as setup from '../services/setup.js'

const router = express.Router()

// 是否还需要初始化（还没有任何用户）
router.get('/status', wrap(async () => ({ needsSetup: await setup.needsSetup() })))

// 执行初始化：创建管理员 + 站点信息 + 预置内容
router.post('/', wrap(async (req) => setup.setup(req.body)))

export default router
