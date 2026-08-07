module.exports = [
  {
    type: 'function',
    function: {
      name: 'inspect_binary',
      description:
        '对用户提供的本地二进制文件做静态结构分析（PE/ELF 头、节区、导入 DLL、导出、可打印字符串、熵、入口十六进制预览）。仅用于用户声明有权分析的样本/自有构建产物/隔离环境研判。不做脱壳破解、不生成 exploit。用户已开启「二进制分析」能力时，对明确给出的文件路径应调用本工具获取证据，再基于结果解读。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '本地二进制路径（.exe/.dll/.sys/.so 等），相对当前项目或绝对路径'
          },
          string_limit: {
            type: 'integer',
            description: '返回的可打印字符串条数上限，默认 200，最大 500'
          },
          max_bytes: {
            type: 'integer',
            description: '最多读取的字节数，默认约 48MB；超大文件只分析头部与前缀'
          }
        },
        required: ['path']
      }
    }
  }
]
