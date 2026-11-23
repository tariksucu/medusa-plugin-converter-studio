import { Module } from '@medusajs/framework/utils';
import ConverterStudioModuleService from './service';

export const CONVERTER_STUDIO_MODULE = 'converterStudio';

export default Module(CONVERTER_STUDIO_MODULE, {
  service: ConverterStudioModuleService,
});

export { ConverterStudioModuleService };
