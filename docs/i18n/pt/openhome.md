---
title: "Controle remoto OpenHome (aplicativo desktop) - EffeTune"
description: "Controle o aplicativo desktop do EffeTune por aplicativos controladores OpenHome na sua rede local: configuração, acesso à rede, compatibilidade e limitações."
lang: pt
---

# Controle remoto OpenHome (aplicativo desktop)

Nas compilações desktop compatíveis (Windows x64, macOS Intel/Apple silicon e Linux x64), o EffeTune pode aparecer como um player OpenHome para aplicativos controladores na mesma rede local. Abra **Configurações > Configuração...**, ative **Permitir controladores OpenHome nesta rede** (desativado por padrão) e aguarde até o status indicar que o EffeTune está disponível. O nome padrão do player é `EffeTune (nome do computador)`; use **Nome do Player** para definir um nome personalizado como `EffeTune Living Room`.

O OpenHome não exige login. Enquanto estiver ativado, outros dispositivos na rede local poderão ver os metadados de reprodução, editar a fila do player e controlar a reprodução. Se o Firewall do Windows solicitar permissão, permita o EffeTune apenas em **Redes privadas**, não em **Redes públicas**. Desative a opção quando o controle remoto não for necessário.

Os controladores podem adicionar fluxos de áudio HTTP ou HTTPS, gerenciar a fila de reprodução remota e controlar reprodução, pausa, parada, avanço de faixa, busca, repetição e modo aleatório. O áudio remoto passa pelo pipeline de efeitos ativo do EffeTune normalmente. O controle básico de fila e reprodução foi verificado com o BubbleUPnP no Android; outros aplicativos OpenHome podem exibir os serviços de forma diferente. O EffeTune opera como uma fonte OpenHome Playlist (não como um UPnP AV MediaRenderer) e não expõe edição de efeitos, caminhos de arquivos locais, volume mestre, Radio, Songcast ou sincronização multiroom via OpenHome.

A reprodução sem intervalos não é garantida, e os metadados técnicos podem permanecer desconhecidos até que a fonte os forneça. Após suspensão, retomada, conexão de VPN ou mudanças de rede, o player pode desaparecer brevemente enquanto se reconecta.

[← Voltar para o README](README.md)
