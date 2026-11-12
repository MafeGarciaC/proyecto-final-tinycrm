package com.spkd.tinycrm.tinyos.config;

import com.spkd.tinycrm.tinyos.entity.User;
import com.spkd.tinycrm.tinyos.service.AuthenticationService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;
import java.io.IOException;
import java.util.Optional;

/**
 * Tolerancia a fallos entre instancias.
 *
 * La HttpSession vive en la memoria de cada backend: si la instancia donde el usuario inició
 * sesión se cae, el balanceador lo manda a la otra y ahí su sesión no existe.
 * El token de sesión sí está en la tabla user_sessions (replicada por Galera) y el frontend
 * lo envía en cada petición como "Authorization: Bearer ...". Si la HttpSession no tiene token
 * pero el header trae uno válido, se reconstruye la sesión en esta instancia.
 */
@Component
public class SessionRestoreFilter extends OncePerRequestFilter {

    private static final String BEARER = "Bearer ";

    @Autowired
    private AuthenticationService authenticationService;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        HttpSession session = request.getSession(false);
        boolean sinToken = session == null || session.getAttribute("sessionToken") == null;
        String header = request.getHeader("Authorization");

        if (sinToken && header != null && header.startsWith(BEARER)) {
            String token = header.substring(BEARER.length()).trim();
            Optional<User> user = authenticationService.validateSession(token);
            if (user.isPresent()) {
                HttpSession nueva = request.getSession(true);
                nueva.setAttribute("sessionToken", token);
                nueva.setAttribute("userId", user.get().getId());
            }
        }
        chain.doFilter(request, response);
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/api/");
    }
}
