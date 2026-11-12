import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { authTokenInterceptor } from '@interceptors/auth-token.interceptor';
import { routes } from './app.routes';
import { provideTranslations } from '@core/providers/translation.provider';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withInterceptors([authTokenInterceptor])),
    provideTranslations(),
    provideRouter(routes)
  ]
};
