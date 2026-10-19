import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.util.Base64;

/**
 * Generador 100% Java 21 del par de llaves RSA (2048 bits, formato PEM PKCS#8 / X.509)
 * para firmar y verificar tokens JWT RS256 en desarrollo local.
 *
 * Ejecución directa sin compilar:
 *   java scripts/GenerarLlavesRsa.java
 */
public class GenerarLlavesRsa {

    public static void main(String[] args) throws Exception {
        Path destinoDir = Path.of("secrets-dev");
        Files.createDirectories(destinoDir);

        Path privadaPath = destinoDir.resolve("jwt-private.pem");
        Path publicaPath = destinoDir.resolve("jwt-public.pem");

        if (Files.exists(privadaPath) && Files.exists(publicaPath)) {
            System.out.println("Las llaves RSA ya existen en " + destinoDir.toAbsolutePath());
            return;
        }

        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        KeyPair keyPair = generator.generateKeyPair();

        escribirPem(privadaPath, "PRIVATE KEY", keyPair.getPrivate().getEncoded());
        escribirPem(publicaPath, "PUBLIC KEY", keyPair.getPublic().getEncoded());

        System.out.println("Par de llaves RSA 2048 generado en: " + destinoDir.toAbsolutePath());
    }

    private static void escribirPem(Path archivo, String tipo, byte[] bytes) throws IOException {
        String base64 = Base64.getMimeEncoder(64, "\n".getBytes(StandardCharsets.UTF_8))
                .encodeToString(bytes);
        String pem = "-----BEGIN " + tipo + "-----\n"
                + base64 + "\n"
                + "-----END " + tipo + "-----\n";
        Files.writeString(archivo, pem, StandardCharsets.UTF_8);
    }
}
