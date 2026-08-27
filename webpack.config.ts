import type { Configuration } from 'webpack';
import { merge } from 'webpack-merge';
import grafanaConfig, { type Env } from './.config/webpack/webpack.config';

const config = async (env: Env): Promise<Configuration> => {
  const baseConfig = await grafanaConfig(env);

  // The default externals list marks `react/jsx-runtime` as external, relying on Grafana
  // core to expose it via its SystemJS import map. Older Grafana versions don't register
  // that module, so loading the plugin fails with a 404 for react/jsx-runtime. Bundle it
  // instead of externalizing it so the plugin also works on older Grafana instances.
  const externals = Array.isArray(baseConfig.externals)
    ? baseConfig.externals.filter((e) => e !== 'react/jsx-runtime' && e !== 'react/jsx-dev-runtime')
    : baseConfig.externals;

  return merge({ ...baseConfig, externals }, {});
};

export default config;
