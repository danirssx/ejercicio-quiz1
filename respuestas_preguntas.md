Justifica por escrito el orden elegido. ¿Cambiaría el resultado si **Tax** se aplica antes que **Coupon**? ¿Por qué importa el orden de **RateLimit**?

- Lo interesante del orden entre el **Coupon** y el **Tax** actual, es que el orden es el incorrecto, ya que lo que está sucediendo es que Tax, que precisamente necesita el valor del `discountUsd`, el lo esta siempre ejecutando en 0, ya que el tiene el valor del descuento que le regresa el `process()` del `BaseOrderProcessor`, si se cambiara el orden esto no sucedería. Con el orden actual, el Tax está siendo mal calculado. El orden correcto debería ser el siguiente:

	RateLimit → FraudDetection → **Tax** → **Coupon** → Base

- El orden del **RateLimit** es importante ya que en teoría el trabajo de este servicio, que es el más delicado, va a ser poder limitar las llamadas para evitar problemas relacionados con la concurrencia o que el usuario realice muchos pedidos por un error de mitigación. Si no lo colocamos como el primero en el orden de ejecución, podrían suceder problemas que afecten al rendimiento del sistema o relacionados con llamadas innecesarias a la base de datos. Además y no menos importante, si no es el primero en llamar, se ejecutarían las llamadas a los otros servicios externos asíncronos antes de rechazar la orden, lo cual es un problema.
