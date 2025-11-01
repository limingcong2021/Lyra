import yaml

try:
    with open('auto-deploy.yml', 'r', encoding='utf-8') as f:
        yaml.safe_load(f)
    print('YAML语法验证通过！')
except Exception as e:
    print(f'YAML验证失败: {e}')