/**
 * 模块归属关键词表（仅 Stage3 模块匹配用）
 * 须与 src/templates/模块匹配规则.md 同步；改文档则升 EXPECTED_MAPPING_VERSION
 */
'use strict';

const EXPECTED_MAPPING_VERSION = '1.5';

/** @type {{ keywords: string[], module: string, module_id: string, sub_module: string, sub_module_id: string, priority: number }[]} */
const BUILTIN_KEYWORD_MAPPING = [
  // ── 三方应用模块（v1.2 新增）──
  { keywords: ['获客易', '货客易', '三方应用', '更多应用', '联登', '授权弹窗', '确认授权', '静默登录'], module: '三方应用模块', module_id: 'THIRD_PARTY', sub_module: '获客易', sub_module_id: 'HUOKE_YI', priority: 1 },
  { keywords: ['找企业', '三方应用', '更多应用'], module: '三方应用模块', module_id: 'THIRD_PARTY', sub_module: '找企业', sub_module_id: 'FIND_ENTERPRISE', priority: 1 },
  { keywords: ['商品查询', '三方应用', '更多应用'], module: '三方应用模块', module_id: 'THIRD_PARTY', sub_module: '商品查询', sub_module_id: 'PRODUCT_QUERY', priority: 1 },
  { keywords: ['鹰眼报告', '三方应用', '更多应用'], module: '三方应用模块', module_id: 'THIRD_PARTY', sub_module: '鹰眼报告', sub_module_id: 'EAGLE_EYE_REPORT', priority: 1 },
  { keywords: ['智慧周转', '三方应用', '更多应用'], module: '三方应用模块', module_id: 'THIRD_PARTY', sub_module: '智慧周转', sub_module_id: 'SMART_TURNOVER', priority: 1 },

  { keywords: ['商品', '商品信息', '商品档案', '新增商品', '商品管理'], module: '商品模块', module_id: 'PRODUCT', sub_module: '商品', sub_module_id: 'PRODUCT_INFO', priority: 1 },
  { keywords: ['规格', '多规格', '规格组合', '规格管理'], module: '商品模块', module_id: 'PRODUCT', sub_module: '规格管理', sub_module_id: 'SPEC_MANAGE', priority: 1 },
  { keywords: ['单位', '计量单位', '单位换算'], module: '商品模块', module_id: 'PRODUCT', sub_module: '单位管理', sub_module_id: 'UNIT_MANAGE', priority: 1 },
  { keywords: ['价格管理', '批发价', '零售价', '价格等级'], module: '商品模块', module_id: 'PRODUCT', sub_module: '价格管理', sub_module_id: 'PRICE_MANAGE', priority: 1 },
  { keywords: ['套餐', '套餐组合'], module: '商品模块', module_id: 'PRODUCT', sub_module: '套餐', sub_module_id: 'PACKAGE', priority: 1 },
  { keywords: ['商品属性', '属性值'], module: '商品模块', module_id: 'PRODUCT', sub_module: '商品属性', sub_module_id: 'PRODUCT_ATTR', priority: 1 },
  { keywords: ['云店商品标签', '商品标签'], module: '商品模块', module_id: 'PRODUCT', sub_module: '云店商品标签', sub_module_id: 'ONLINE_TAG', priority: 1 },
  { keywords: ['搜索', '搜索商品', '分类搜索', '分类标签', '分类筛选', '扫码搜索', '分类下搜索', '切换分类', '清空搜索', '搜索结果'], module: '商品模块', module_id: 'PRODUCT', sub_module: '搜索', sub_module_id: 'PRODUCT_SEARCH', priority: 1 },

  { keywords: ['销售单', '销售开单', '销售保存', '销售'], module: '销售模块', module_id: 'SALE', sub_module: '销售', sub_module_id: 'SALE_ORDER', priority: 1 },
  { keywords: ['开单'], module: '销售模块', module_id: 'SALE', sub_module: '销售', sub_module_id: 'SALE_ORDER', priority: 1 },
  { keywords: ['退货', '退货单', '销售退货', '退款'], module: '销售模块', module_id: 'SALE', sub_module: '销售退货', sub_module_id: 'SALE_RETURN', priority: 1 },
  { keywords: ['预订', '预订单', '预订转销售'], module: '销售模块', module_id: 'SALE', sub_module: '销售预订', sub_module_id: 'SALE_BOOKING', priority: 1 },
  { keywords: ['云店订单', '小程序订单', '线上订单'], module: '销售模块', module_id: 'SALE', sub_module: '云店订单', sub_module_id: 'ONLINE_ORDER', priority: 1 },
  { keywords: ['报价', '报价单', '销售报价'], module: '销售模块', module_id: 'SALE', sub_module: '报价', sub_module_id: 'QUOTATION', priority: 1 },
  { keywords: ['业绩', '提成', '销售员'], module: '销售模块', module_id: 'SALE', sub_module: '业绩提成', sub_module_id: 'PERFORMANCE', priority: 1 },
  { keywords: ['快递', '物流', '快递单'], module: '销售模块', module_id: 'SALE', sub_module: '快递服务', sub_module_id: 'EXPRESS', priority: 1 },

  { keywords: ['客户来源', '客户档案', '客户信息', '客户'], module: '客户模块', module_id: 'CUSTOMER', sub_module: '客户', sub_module_id: 'CUSTOMER_INFO', priority: 1 },
  { keywords: ['客户价格等级', '客户等级'], module: '客户模块', module_id: 'CUSTOMER', sub_module: '价格等级', sub_module_id: 'PRICE_LEVEL', priority: 1 },
  { keywords: ['客户报价'], module: '客户模块', module_id: 'CUSTOMER', sub_module: '报价管理', sub_module_id: 'CUSTOMER_QUOTE', priority: 1 },

  { keywords: ['供应商', '供应商档案'], module: '进货模块', module_id: 'PURCHASE', sub_module: '供应商', sub_module_id: 'SUPPLIER', priority: 1 },
  { keywords: ['进货', '进货单', '采购', '进货开单'], module: '进货模块', module_id: 'PURCHASE', sub_module: '进货', sub_module_id: 'PURCHASE_ORDER', priority: 1 },
  { keywords: ['进货预订', '采购预订'], module: '进货模块', module_id: 'PURCHASE', sub_module: '进货预订', sub_module_id: 'PURCHASE_BOOKING', priority: 1 },
  { keywords: ['进货退货', '采购退货'], module: '进货模块', module_id: 'PURCHASE', sub_module: '进货退货', sub_module_id: 'PURCHASE_RETURN', priority: 1 },

  { keywords: ['盘点', '库存盘点'], module: '库存模块', module_id: 'INVENTORY', sub_module: '盘点', sub_module_id: 'STOCK_CHECK', priority: 1 },
  { keywords: ['调拨', '跨仓调拨'], module: '库存模块', module_id: 'INVENTORY', sub_module: '调拨', sub_module_id: 'STOCK_TRANSFER', priority: 1 },
  { keywords: ['组装', '商品组装'], module: '库存模块', module_id: 'INVENTORY', sub_module: '组装', sub_module_id: 'ASSEMBLE', priority: 1 },
  { keywords: ['拆分', '商品拆分'], module: '库存模块', module_id: 'INVENTORY', sub_module: '拆分', sub_module_id: 'DISASSEMBLE', priority: 1 },
  { keywords: ['库存查询', '库存数量', '库存'], module: '库存模块', module_id: 'INVENTORY', sub_module: '库存查询', sub_module_id: 'STOCK_QUERY', priority: 1 },
  { keywords: ['库存预警'], module: '库存模块', module_id: 'INVENTORY', sub_module: '库存预警', sub_module_id: 'STOCK_WARNING', priority: 1 },
  { keywords: ['批次', '批次号', '批次查询'], module: '库存模块', module_id: 'INVENTORY', sub_module: '批次查询', sub_module_id: 'BATCH_QUERY', priority: 1 },
  { keywords: ['保质期', '效期'], module: '库存模块', module_id: 'INVENTORY', sub_module: '保质期查询', sub_module_id: 'EXPIRY_QUERY', priority: 1 },
  { keywords: ['序列号', '序列号管理', '序列号查询'], module: '库存模块', module_id: 'INVENTORY', sub_module: '序列号查询', sub_module_id: 'SERIAL_QUERY', priority: 1 },

  { keywords: ['账户', '资金账户', '账户概览'], module: '资金模块', module_id: 'FINANCE', sub_module: '账户概览', sub_module_id: 'ACCOUNT_OVERVIEW', priority: 1 },
  { keywords: ['转账'], module: '资金模块', module_id: 'FINANCE', sub_module: '转账', sub_module_id: 'TRANSFER', priority: 1 },
  { keywords: ['收款', '收款单', '销售收款', '收账', '支付'], module: '资金模块', module_id: 'FINANCE', sub_module: '收款', sub_module_id: 'RECEIVE', priority: 1 },
  { keywords: ['付款', '付款单', '进货付款'], module: '资金模块', module_id: 'FINANCE', sub_module: '付款', sub_module_id: 'PAYMENT', priority: 1 },
  { keywords: ['其他收入'], module: '资金模块', module_id: 'FINANCE', sub_module: '其他收入', sub_module_id: 'OTHER_INCOME', priority: 1 },
  { keywords: ['其他支出'], module: '资金模块', module_id: 'FINANCE', sub_module: '其他支出', sub_module_id: 'OTHER_EXPENSE', priority: 1 },
  { keywords: ['客户对账', '对账'], module: '资金模块', module_id: 'FINANCE', sub_module: '客户对账', sub_module_id: 'CUSTOMER_RECONCILE', priority: 1 },
  { keywords: ['供应商对账'], module: '资金模块', module_id: 'FINANCE', sub_module: '供应商对账', sub_module_id: 'SUPPLIER_RECONCILE', priority: 1 },
  { keywords: ['资金流水', '流水'], module: '资金模块', module_id: 'FINANCE', sub_module: '资金流水', sub_module_id: 'FUND_FLOW', priority: 1 },

  { keywords: ['销售统计', '销售报表'], module: '分析模块', module_id: 'ANALYSIS', sub_module: '销售统计', sub_module_id: 'SALE_STAT', priority: 1 },
  { keywords: ['热销', '热销分析'], module: '分析模块', module_id: 'ANALYSIS', sub_module: '热销分析', sub_module_id: 'HOT_SALE', priority: 1 },
  { keywords: ['员工业绩', '业绩统计'], module: '分析模块', module_id: 'ANALYSIS', sub_module: '员工业绩统计', sub_module_id: 'EMPLOYEE_STAT', priority: 1 },
  { keywords: ['进货统计'], module: '分析模块', module_id: 'ANALYSIS', sub_module: '进货统计', sub_module_id: 'PURCHASE_STAT', priority: 1 },
  { keywords: ['库存统计'], module: '分析模块', module_id: 'ANALYSIS', sub_module: '库存统计', sub_module_id: 'INVENTORY_STAT', priority: 1 },
  { keywords: ['利润', '经营利润'], module: '分析模块', module_id: 'ANALYSIS', sub_module: '经营利润', sub_module_id: 'PROFIT', priority: 1 },

  { keywords: ['云店', '线上店铺'], module: '云店模块', module_id: 'ONLINE_SHOP', sub_module: '我的云店', sub_module_id: 'MY_SHOP', priority: 1 },
  { keywords: ['装修', '店铺装修'], module: '云店模块', module_id: 'ONLINE_SHOP', sub_module: '云店装修', sub_module_id: 'SHOP_DECORATION', priority: 1 },
  { keywords: ['商品排序', '展示顺序'], module: '云店模块', module_id: 'ONLINE_SHOP', sub_module: '云店商品排序', sub_module_id: 'SHOP_SORT', priority: 1 },
  { keywords: ['云店设置'], module: '云店模块', module_id: 'ONLINE_SHOP', sub_module: '云店设置', sub_module_id: 'SHOP_SETTINGS', priority: 1 },
  { keywords: ['选购', '云店选购', '云店首页选购'], module: '云店模块', module_id: 'ONLINE_SHOP', sub_module: '选购', sub_module_id: 'SHOP_BROWSE', priority: 1 },
  { keywords: ['买家订单', '我的订单', '云店订单页', '订单 Tab'], module: '云店模块', module_id: 'ONLINE_SHOP', sub_module: '订单', sub_module_id: 'SHOP_ORDER_TAB', priority: 1 },
  { keywords: ['云店我的', '买家个人中心', '云店个人中心'], module: '云店模块', module_id: 'ONLINE_SHOP', sub_module: '我的', sub_module_id: 'SHOP_MINE', priority: 1 },

  { keywords: ['商户', '商户信息'], module: '设置模块', module_id: 'SETTINGS', sub_module: '商户信息', sub_module_id: 'MERCHANT_INFO', priority: 1 },
  { keywords: ['门店', '门店管理'], module: '设置模块', module_id: 'SETTINGS', sub_module: '门店管理', sub_module_id: 'SHOP_MANAGE', priority: 1 },
  { keywords: ['仓库', '仓库管理'], module: '设置模块', module_id: 'SETTINGS', sub_module: '仓库管理', sub_module_id: 'WAREHOUSE', priority: 1 },
  { keywords: ['员工', '员工管理', '员工信息'], module: '设置模块', module_id: 'SETTINGS', sub_module: '员工管理', sub_module_id: 'EMPLOYEE', priority: 1 },
  { keywords: ['权限', '角色权限', '权限配置'], module: '设置模块', module_id: 'SETTINGS', sub_module: '角色权限', sub_module_id: 'ROLE_PERMISSION', priority: 1 },
  { keywords: ['POS设备', 'POS'], module: '设置模块', module_id: 'SETTINGS', sub_module: 'POS设备', sub_module_id: 'POS_DEVICE', priority: 1 },
  { keywords: ['系统设置', '系统参数', '功能开关', '后台配置'], module: '设置模块', module_id: 'SETTINGS', sub_module: '系统设置', sub_module_id: 'SYSTEM_SETTINGS', priority: 1 },
  { keywords: ['用户偏好', '偏好设置'], module: '设置模块', module_id: 'SETTINGS', sub_module: '用户偏好设置', sub_module_id: 'USER_PREFERENCE', priority: 1 },
  { keywords: ['打印', '打印模板', '打印设置'], module: '设置模块', module_id: 'SETTINGS', sub_module: '打印设置', sub_module_id: 'PRINT_SETTINGS', priority: 1 },
  { keywords: ['积分', '积分设置', '积分规则'], module: '设置模块', module_id: 'SETTINGS', sub_module: '积分设置', sub_module_id: 'POINT_SETTINGS', priority: 1 },
  { keywords: ['系统初始化', '初始化'], module: '设置模块', module_id: 'SETTINGS', sub_module: '系统初始化', sub_module_id: 'SYSTEM_INIT', priority: 1 },

  { keywords: ['性能', '响应时间', '并发', '吞吐量'], module: '非功能模块', module_id: 'NON_FUNCTIONAL', sub_module: '性能测试', sub_module_id: 'PERFORMANCE_TEST', priority: 1 },
  { keywords: ['集成', '接口', '对接', '网络异常', '降级', '报错'], module: '非功能模块', module_id: 'NON_FUNCTIONAL', sub_module: '集成测试', sub_module_id: 'INTEGRATION_TEST', priority: 1 },
  { keywords: ['安全', '数据安全', '权限安全'], module: '非功能模块', module_id: 'NON_FUNCTIONAL', sub_module: '安全测试', sub_module_id: 'SECURITY_TEST', priority: 1 },
  { keywords: ['兼容', '多端兼容', '多浏览器', '旧版', '旧版APP', '版本升级'], module: '非功能模块', module_id: 'NON_FUNCTIONAL', sub_module: '兼容性测试', sub_module_id: 'COMPATIBILITY_TEST', priority: 1 }
];

function toModuleL1(moduleName) {
  if (moduleName === '非功能模块') return '非功能';
  return String(moduleName || '').replace(/模块$/, '') || '未匹配';
}

module.exports = {
  EXPECTED_MAPPING_VERSION,
  BUILTIN_KEYWORD_MAPPING,
  toModuleL1
};
