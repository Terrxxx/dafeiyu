export function emailAddress(value) {
  if (typeof value !== "string")
    throw Object.assign(Error("请输入邮箱地址"), { status: 400 });
  const email = value.trim().toLowerCase();
  if (
    email.length > 254 ||
    !/^[a-z0-9._%+\-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/i.test(
      email,
    ) ||
    email.includes("..")
  )
    throw Object.assign(Error("邮箱格式无效"), { status: 400 });
  return email;
}
