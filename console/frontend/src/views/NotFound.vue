<template>
  <div class="yh-page">
    <el-result icon="info" title="页面不存在" sub-title="你访问的页面不存在或已被移除">
      <template #extra>
        <el-button type="primary" @click="$router.replace('/')">回到工作台</el-button>
      </template>
    </el-result>
  </div>
</template>
