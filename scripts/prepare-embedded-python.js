const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const { createWriteStream } = require('fs');
const { pipeline } = require('stream');
const { promisify } = require('util');
const tar = require('tar');

const pipelineAsync = promisify(pipeline);

class EmbeddedPythonBuilder {
  constructor() {
    this.pythonVersion = '3.11.6';
    this.buildDate = '20231002';
    this.pythonDir = path.join(__dirname, '..', 'python');
    this.isWindows = process.platform === 'win32';
    this.forceReinstall = false;
  }

  getPythonExecutablePath() {
    const candidates = this.isWindows
      ? [
          path.join(this.pythonDir, 'Scripts', 'python.exe'),
          path.join(this.pythonDir, 'python.exe')
        ]
      : [path.join(this.pythonDir, 'bin', 'python3.11')];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return candidates[0];
  }

  getSitePackagesPath() {
    if (this.isWindows) {
      return path.join(this.pythonDir, 'Lib', 'site-packages');
    }
    return path.join(this.pythonDir, 'lib', 'python3.11', 'site-packages');
  }

  createPythonProcessEnv() {
    const env = {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUNBUFFERED: '1',
    };

    // Virtualenv on Windows should use its own interpreter layout.
    if (!this.isWindows) {
      env.PYTHONHOME = this.pythonDir;
      env.PYTHONPATH = this.getSitePackagesPath();
      env.LD_LIBRARY_PATH = path.join(this.pythonDir, 'lib');
      env.DYLD_LIBRARY_PATH = path.join(this.pythonDir, 'lib');
    }

    delete env.PYTHONUSERBASE;
    delete env.PYTHONSTARTUP;
    delete env.VIRTUAL_ENV;

    return env;
  }

  async build() {
    console.log('🐍 开始准备嵌入式Python环境...');
    
    try {
      // 1. 检查现有环境是否完整（除非强制重新安装）
      if (!this.forceReinstall) {
        const existingInfo = await this.getEmbeddedPythonInfo();
        if (existingInfo && existingInfo.ready) {
          console.log('✅ 检测到现有的嵌入式Python环境:');
          console.log(`   版本: ${existingInfo.version}`);
          console.log(`   大小: ${existingInfo.size.mb}MB (${existingInfo.size.files} 个文件)`);
          
          // 验证关键依赖是否完整
          const pythonPath = this.getPythonExecutablePath();
          const isValid = await this.validateExistingEnvironment(pythonPath);
          
          if (isValid) {
            console.log('✅ 现有环境验证通过，跳过重新安装');
            return;
          } else {
            console.log('⚠️ 现有环境不完整，将重新安装...');
          }
        } else {
          console.log('📋 未检测到现有环境或环境不可用，开始全新安装...');
        }
      } else {
        console.log('🔄 强制重新安装模式，跳过现有环境检查');
      }
      
      // 2. 清理现有Python目录
      await this.cleanup();
      
      // 3. 下载Python运行时
      await this.downloadPythonRuntime();
      
      // 4. 安装Python依赖
      await this.installDependencies();
      
      // 5. 清理不必要文件
      await this.cleanupUnnecessaryFiles();
      
      console.log('✅ 嵌入式Python环境准备完成！');
      
    } catch (error) {
      console.error('❌ 准备Python环境失败:', error.message);
      process.exit(1);
    }
  }

  async cleanup() {
    if (fs.existsSync(this.pythonDir)) {
      console.log('🧹 清理现有Python目录...');
      fs.rmSync(this.pythonDir, { recursive: true, force: true });
    }
    fs.mkdirSync(this.pythonDir, { recursive: true });
  }

  async downloadPythonRuntime() {
    if (this.isWindows) {
      console.log('🪟 Windows 环境：使用 uv 创建隔离 Python 3.11 运行时...');
      try {
        execSync(`uv venv --python 3.11 --seed "${this.pythonDir}"`, { stdio: 'inherit' });
        console.log('✅ Windows Python 运行时创建完成');
        return;
      } catch (error) {
        throw new Error(`使用 uv 创建 Windows Python 环境失败: ${error.message}`);
      }
    }

    const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
    const filename = `cpython-${this.pythonVersion}+${this.buildDate}-${arch}-apple-darwin-install_only.tar.gz`;
    const url = `https://github.com/indygreg/python-build-standalone/releases/download/${this.buildDate}/${filename}`;
    const tarPath = path.join(this.pythonDir, 'python.tar.gz');

    console.log(`📥 下载Python运行时 (${arch})...`);
    console.log(`URL: ${url}`);

    await this.downloadFile(url, tarPath);
    
    console.log('📦 解压Python运行时...');
    await tar.extract({
      file: tarPath,
      cwd: this.pythonDir,
      strip: 1
    });

    // 删除压缩包
    fs.unlinkSync(tarPath);
    
    console.log('✅ Python运行时下载完成');
  }

  async downloadFile(url, outputPath) {
    return new Promise((resolve, reject) => {
      const file = createWriteStream(outputPath);
      
      https.get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // 处理重定向
          return this.downloadFile(response.headers.location, outputPath)
            .then(resolve)
            .catch(reject);
        }
        
        if (response.statusCode !== 200) {
          reject(new Error(`下载失败: HTTP ${response.statusCode}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloadedSize = 0;

        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          if (totalSize) {
            const progress = Math.round((downloadedSize / totalSize) * 100);
            process.stdout.write(`\r进度: ${progress}% (${Math.round(downloadedSize / 1024 / 1024)}MB / ${Math.round(totalSize / 1024 / 1024)}MB)`);
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          console.log('\n✅ 下载完成');
          resolve();
        });

        file.on('error', (error) => {
          fs.unlink(outputPath, () => {}); // 错误时清理
          reject(error);
        });

      }).on('error', (error) => {
        reject(error);
      });
    });
  }

  async installDependencies() {
    const pythonPath = this.getPythonExecutablePath();
    const installEnv = this.createPythonProcessEnv();

    console.log('📦 安装Python依赖...');

    // 确保pip是最新的（Windows 上优先使用 uv pip，避免 pip 缺失问题）
    if (this.isWindows) {
      console.log('⬆️ 使用 uv pip 预热安装能力...');
      try {
        execSync(`uv pip install --python "${pythonPath}" pip`, {
          stdio: 'inherit',
          env: installEnv
        });
      } catch (error) {
        console.warn('⚠️ uv pip 预热失败，继续尝试安装依赖...');
      }
    } else {
      console.log('⬆️ 升级pip...');
      try {
        execSync(`"${pythonPath}" -m pip install --upgrade pip`, {
          stdio: 'inherit',
          env: installEnv
        });
      } catch (error) {
        console.warn('⚠️ pip升级失败，继续安装依赖...');
      }
    }

    // 定义依赖列表 - 确保numpy等核心依赖被正确安装
    const dependencies = [
      'numpy<2',  // 先安装numpy，作为其他库的基础依赖
      'torch==2.0.1',
      'torchaudio==2.0.2',
      'torchvision==0.15.2',
      'modelscope',
      'librosa>=0.11.0',
      'funasr>=1.2.7'
    ];

    // 逐个安装依赖（包含所有子依赖）
    for (const dep of dependencies) {
      console.log(`📦 安装 ${dep}...`);
      try {
        if (this.isWindows) {
          execSync(`uv pip install --python "${pythonPath}" --reinstall "${dep}"`, {
            stdio: 'inherit',
            env: installEnv
          });
        } else {
          execSync(`"${pythonPath}" -m pip install --upgrade --force-reinstall "${dep}"`, {
            stdio: 'inherit',
            env: installEnv
          });
        }
        
        console.log(`✅ ${dep} 安装完成`);
      } catch (error) {
        console.error(`❌ ${dep} 安装失败:`, error.message);
        try {
          console.log(`🔄 重试安装 ${dep} (包含依赖)...`);
          if (this.isWindows) {
            execSync(`uv pip install --python "${pythonPath}" "${dep}"`, {
              stdio: 'inherit',
              env: installEnv
            });
          } else {
            execSync(`"${pythonPath}" -m pip install --upgrade "${dep}"`, {
              stdio: 'inherit',
              env: installEnv
            });
          }
          console.log(`✅ ${dep} 重试安装成功`);
        } catch (retryError) {
          console.error(`❌ ${dep} 重试安装也失败:`, retryError.message);
          // 继续安装其他依赖
        }
      }
    }

    // 验证关键依赖
    await this.verifyDependencies(pythonPath);
  }

  async verifyDependencies(pythonPath) {
    console.log('🔍 验证依赖安装...');
    
    const criticalDeps = ['numpy', 'torch', 'librosa', 'modelscope', 'funasr'];
    const verifyEnv = this.createPythonProcessEnv();
    
    for (const dep of criticalDeps) {
      try {
        const result = execSync(`"${pythonPath}" -c "import ${dep}; print('${dep} OK')"`, {
          stdio: 'pipe',
          env: verifyEnv
        });
        
        console.log(`✅ ${dep} 验证通过: ${result.toString().trim()}`);
      } catch (error) {
        console.error(`❌ ${dep} 验证失败:`, error.message);
        console.error('错误输出:', error.stderr?.toString() || '无');
        throw new Error(`关键依赖 ${dep} 安装失败: ${error.message}`);
      }
    }
  }

  async validateExistingEnvironment(pythonPath) {
    console.log('🔍 验证现有环境完整性...');
    
    try {
      // 检查Python可执行文件是否存在
      if (!fs.existsSync(pythonPath)) {
        console.log('❌ Python可执行文件不存在');
        return false;
      }
      
      // 检查关键依赖是否可用
      const criticalDeps = ['numpy', 'torch', 'librosa', 'modelscope', 'funasr'];
      const verifyEnv = this.createPythonProcessEnv();
      
      for (const dep of criticalDeps) {
        try {
          execSync(`"${pythonPath}" -c "import ${dep}; print('${dep} OK')"`, {
            stdio: 'pipe',
            env: verifyEnv,
            timeout: 10000 // 10秒超时
          });
          console.log(`✅ ${dep} 可用`);
        } catch (error) {
          console.log(`❌ ${dep} 不可用: ${error.message}`);
          return false;
        }
      }
      
      console.log('✅ 现有环境验证完成，所有关键依赖都可用');
      return true;
      
    } catch (error) {
      console.log(`❌ 环境验证失败: ${error.message}`);
      return false;
    }
  }

  async cleanupUnnecessaryFiles() {
    console.log('🧹 清理不必要文件...');
    
    const unnecessaryPaths = [
      path.join(this.pythonDir, 'share', 'doc'),
      path.join(this.pythonDir, 'share', 'man'),
      path.join(this.pythonDir, 'include'),
      path.join(this.pythonDir, 'lib', 'pkgconfig'),
      path.join(this.pythonDir, 'lib', 'python3.11', 'test'),
      path.join(this.pythonDir, 'lib', 'python3.11', 'distutils'),
    ];

    for (const unnecessaryPath of unnecessaryPaths) {
      if (fs.existsSync(unnecessaryPath)) {
        try {
          fs.rmSync(unnecessaryPath, { recursive: true, force: true });
          console.log(`🗑️ 删除: ${path.relative(this.pythonDir, unnecessaryPath)}`);
        } catch (error) {
          console.warn(`⚠️ 无法删除: ${unnecessaryPath}`);
        }
      }
    }

    // 删除.pyc文件
    this.deletePycFiles(this.pythonDir);
    
    console.log('✅ 清理完成');
  }

  deletePycFiles(dir) {
    const items = fs.readdirSync(dir);
    
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        if (item === '__pycache__') {
          fs.rmSync(fullPath, { recursive: true, force: true });
        } else {
          this.deletePycFiles(fullPath);
        }
      } else if (item.endsWith('.pyc')) {
        fs.unlinkSync(fullPath);
      }
    }
  }

  async getEmbeddedPythonInfo() {
    const pythonPath = this.getPythonExecutablePath();
    
    if (!fs.existsSync(pythonPath)) {
      return null;
    }

    try {
      const version = execSync(`"${pythonPath}" --version`, { 
        encoding: 'utf8',
        env: this.createPythonProcessEnv()
      }).trim();
      
      const sizeInfo = this.getDirectorySize(this.pythonDir);
      
      return {
        version,
        path: pythonPath,
        size: sizeInfo,
        ready: true
      };
    } catch (error) {
      return {
        ready: false,
        error: error.message
      };
    }
  }

  getDirectorySize(dirPath) {
    let totalSize = 0;
    let fileCount = 0;

    const calculateSize = (dir) => {
      const items = fs.readdirSync(dir);
      
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          calculateSize(fullPath);
        } else {
          totalSize += stat.size;
          fileCount++;
        }
      }
    };

    calculateSize(dirPath);
    
    return {
      bytes: totalSize,
      mb: Math.round(totalSize / 1024 / 1024),
      files: fileCount
    };
  }
}

// 主函数
async function main() {
  const builder = new EmbeddedPythonBuilder();
  
  if (process.argv.includes('--info')) {
    const info = await builder.getEmbeddedPythonInfo();
    console.log('嵌入式Python信息:', JSON.stringify(info, null, 2));
    return;
  }
  
  // 检查是否强制重新安装
  if (process.argv.includes('--force')) {
    console.log('🔄 强制重新安装模式');
    builder.forceReinstall = true;
  }
  
  await builder.build();
  
  // 显示最终信息
  const info = await builder.getEmbeddedPythonInfo();
  console.log('\n📊 嵌入式Python环境信息:');
  console.log(`版本: ${info.version}`);
  console.log(`路径: ${info.path}`);
  console.log(`大小: ${info.size.mb}MB (${info.size.files} 个文件)`);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = EmbeddedPythonBuilder;