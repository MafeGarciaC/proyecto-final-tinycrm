# Preguntas para el profe (Jhon Jaime Méndez)

Actualizadas el 11-nov después de leer el diagrama `.drawio`. Ordenadas por importancia.

1. **Integrantes.** El PDF dice 3 integrantes y nuestro grupo es de 4. ¿Está bien?
2. **Sincronización de usuarios.** En el diagrama la flecha va del **Cluster DB al Broker**. ¿Espera que el evento salga de la base de datos (trigger/outbox o CDC tipo Debezium), o podemos modificar el código de TinyCRM para que publique el evento al crear un usuario?
3. **Middleware.** Los dos clientes usan el mismo dominio `www.tiny.com`. ¿El middleware debe identificar al cliente por el usuario que inicia sesión (buscándolo en la BD "Usuarios")? ¿O espera otra forma (subdominio, parámetro)?
4. **Registro de usuarios nuevos.** TinyCRM tiene registro público ("Create Account"). Si un usuario se registra solo, ¿a qué cliente pertenece? ¿Desactivamos el registro público y que solo el admin de cada cliente cree usuarios?
5. **Usuarios repetidos.** Si existe `admin` en el cliente A y otro `admin` en el cliente B, el middleware no sabe a cuál enviar. ¿Exigimos usernames únicos entre clientes?
6. **Clúster de BD.** El diagrama muestra un solo clúster y un solo LB BD para A y B. ¿Es correcto usar una base de datos por cliente dentro del mismo clúster (con usuarios MySQL separados) para el aislamiento? ¿3 nodos?
7. **IPs.** ¿Hay que usar exactamente las IPs del diagrama (192.168.0.x / 1.x / 2.x)? La red de la casa de una integrante es 192.168.1.x y choca con la DMZ.
8. **Máquina #2.** ¿La Máquina #2 es solo la de los usuarios (navegador), o también debe correr el DNS y el firewall?
9. **Tolerancia a fallos.** Al caer una instancia, ¿basta con que el sistema siga respondiendo (el usuario puede tener que volver a iniciar sesión) o debe conservar la sesión?
10. **Broker.** ¿Tiene preferencia entre RabbitMQ y Kafka?
11. **Sustentación.** ¿Fecha, si es presencial o virtual, y cuánto tiempo por grupo?

Ya resuelto con el diagrama: dónde va el firewall, cuántas redes hay (externa, DMZ, interna) y qué es el componente central (BD "Usuarios" + Consumer). Los cuadros del diagrama dicen "SuiteCRM", pero el software del PDF es TinyCRM.
