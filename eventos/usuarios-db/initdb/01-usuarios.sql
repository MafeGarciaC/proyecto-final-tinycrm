-- BD "Usuarios" del diagrama (componente central).
-- Guarda a qué cliente pertenece cada usuario de TinyCRM.
--   * La llena el Consumer con los eventos "usuario creado" que llegan del broker.
--   * La consulta el Middleware en el login para saber a qué Load Balancer enviar al usuario.

CREATE DATABASE IF NOT EXISTS usuarios CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE usuarios;

CREATE TABLE IF NOT EXISTS usuarios (
    username     VARCHAR(255) NOT NULL PRIMARY KEY,   -- único entre TODOS los clientes
    email        VARCHAR(255) NOT NULL,
    cliente      CHAR(1)      NOT NULL,               -- 'A' o 'B'
    id_en_cliente BIGINT      NULL,                   -- id del usuario en la BD de su cliente
    creado_en    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sincronizado_en DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_email (email),
    CONSTRAINT ck_cliente CHECK (cliente IN ('A', 'B'))
);
