import { handleMemberLogout } from "../../../_shared/auth-api.mjs";

export const onRequestPost = ({ request, env }) => handleMemberLogout(request, env);
