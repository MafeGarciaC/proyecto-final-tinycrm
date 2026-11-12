package com.spkd.tinycrm.tinyos.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    // Orígenes permitidos separados por coma; admite patrones (http://*.acme.local:*).
    // Antes estaban fijos en localhost:3000/8080 y el backend respondía 403 detrás del balanceador.
    @Value("${CORS_ALLOWED_ORIGINS:http://localhost:*}")
    private String[] allowedOrigins;

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/**")
                .allowedOriginPatterns(allowedOrigins)
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH")
                .allowedHeaders("*")
                .allowCredentials(true)
                .maxAge(3600); // Cache preflight for 1 hour
    }
}
