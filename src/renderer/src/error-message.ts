/**
 * 渲染进程用的错误提示。
 * 实现统一放在 shared/error-message.ts，主进程与渲染进程共用同一套翻译规则。
 */
export { toUserMessage as getErrorMessage } from '../../shared/error-message'
