<template>
  <SettingsTab page="login" :intro="intro" />
</template>

<script setup>
import SettingsTab from './SettingsTab.vue'

const intro = '用户用什么方式登录平台。平台上所有应用都走这里的统一登录，所以改了这里，所有应用一起生效。至少要保留一种可用的方式；钉钉、飞书、企业微信可以同时打开，登录页各显示一个按钮；在对应客户端里打开平台时自动免登。同一个人用不同方式登录，手机号或邮箱一致时会对上同一个用户。飞书相关的身份 ID（如管理员 open_id）优先用 open_id（ou_ 开头），别用 union_id（on_ 开头）或 user_id。开发登录（选人即登录）只在测试模式（yh init --test）自动打开。'
</script>
